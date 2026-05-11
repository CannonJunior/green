/**
 * Fetches a URL and returns its content as plain text, suitable for passing
 * to the agent as a tool result.
 */

const MAX_CHARS = 20_000;

export async function fetchUrl(url: string): Promise<string> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'User-Agent': 'Green/1.0 (personal assistant)' },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      if (attempt < 2) { await new Promise(r => setTimeout(r, 500)); continue; }
      return `Fetch failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    if (!response.ok) {
      if (attempt < 2 && response.status >= 500) { await new Promise(r => setTimeout(r, 500)); continue; }
      return `HTTP ${response.status} ${response.statusText}`;
    }

    const contentType = response.headers.get('content-type') ?? '';
    const text = await response.text();
    const plain = contentType.includes('html') ? stripHtml(text) : text;
    const trimmed = plain.trim();
    if (trimmed.length <= MAX_CHARS) return trimmed;
    return trimmed.slice(0, MAX_CHARS) + `\n\n[truncated — ${trimmed.length} chars total]`;
  }
  return 'Fetch failed: unknown error'; // unreachable
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
