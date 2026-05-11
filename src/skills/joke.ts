/**
 * /joke skill — parse arguments, load comedian style context from the
 * comedy-taxonomy project, and build a prompt for the agent to generate
 * a topical joke via web search.
 */
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComedianDimensions {
  physical_verbal: number;      // 0 = pure verbal/wordplay, 10 = pure physical
  safe_provocative: number;     // 0 = family-friendly, 10 = boundary-pushing
  character_observational: number; // 0 = pure observational, 10 = character-based
}

export interface ComedianData {
  id: string;
  name: string;
  birth_year: number;
  death_year?: number;
  nationality: string;
  primary_category: string;
  dimensions: ComedianDimensions;
  quote: string;
  profile_path: string;
}

export type JokeStyle = 'dark' | 'safe' | 'wordplay' | 'absurdist' | 'observational' | 'satire';

export interface JokeOptions {
  topic?: string;
  comedianQuery?: string;
  styles: Set<JokeStyle>;
}

const VALID_STYLES = new Set<string>(['dark', 'safe', 'wordplay', 'absurdist', 'observational', 'satire']);

// ---------------------------------------------------------------------------
// Argument parser
// ---------------------------------------------------------------------------

/**
 * Parse a /joke argument string.
 *
 * Recognized forms (combinable):
 *   about <topic>        — search for news on this topic
 *   like <comedian>      — adopt a specific comedian's style
 *   -dark / -safe / -wordplay / -absurdist / -observational / -satire
 *
 * Bare tokens with no keyword are treated as topic text.
 */
export function parseJokeArgs(arg: string): JokeOptions {
  const opts: JokeOptions = { styles: new Set() };
  const tokens = arg.split(/\s+/).filter(Boolean);
  let i = 0;

  while (i < tokens.length) {
    const t = tokens[i];

    if (t.startsWith('-')) {
      const flag = t.slice(1).toLowerCase();
      if (VALID_STYLES.has(flag)) opts.styles.add(flag as JokeStyle);
      i++;
      continue;
    }

    const tl = t.toLowerCase();

    if (tl === 'about') {
      const parts: string[] = [];
      i++;
      while (i < tokens.length && tokens[i].toLowerCase() !== 'like' && !tokens[i].startsWith('-')) {
        parts.push(tokens[i++]);
      }
      if (parts.length > 0) opts.topic = parts.join(' ');
      continue;
    }

    if (tl === 'like') {
      const parts: string[] = [];
      i++;
      while (i < tokens.length && tokens[i].toLowerCase() !== 'about' && !tokens[i].startsWith('-')) {
        parts.push(tokens[i++]);
      }
      if (parts.length > 0) opts.comedianQuery = parts.join(' ');
      continue;
    }

    // Bare token — treat as topic
    opts.topic = opts.topic ? `${opts.topic} ${t}` : t;
    i++;
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Comedian lookup
// ---------------------------------------------------------------------------

let _comediansCache: { projectPath: string; data: ComedianData[] } | null = null;

export function loadComedians(comedyProjectPath: string): ComedianData[] {
  if (_comediansCache?.projectPath === comedyProjectPath) return _comediansCache.data;
  try {
    const raw = fs.readFileSync(
      path.join(comedyProjectPath, 'webapp', 'data', 'comedians.json'),
      'utf8',
    );
    const parsed = JSON.parse(raw) as { comedians: ComedianData[] };
    const data = parsed.comedians ?? [];
    _comediansCache = { projectPath: comedyProjectPath, data };
    return data;
  } catch {
    return [];
  }
}

/**
 * Find the best comedian match for a query string.
 * Priority: exact name match → starts-with → any-word → substring.
 */
export function findComedian(comedians: ComedianData[], query: string): ComedianData | null {
  const q = query.toLowerCase().trim();
  if (!q) return null;

  return (
    comedians.find(c => c.name.toLowerCase() === q) ??
    comedians.find(c => c.name.toLowerCase().startsWith(q)) ??
    comedians.find(c => c.name.toLowerCase().split(/\s+/).some(w => w === q)) ??
    comedians.find(c => c.name.toLowerCase().includes(q)) ??
    null
  );
}

// ---------------------------------------------------------------------------
// Comedian style context builder
// ---------------------------------------------------------------------------

/** Convert dimension scores to human-readable phrases. */
function describeDimensions(d: ComedianDimensions): string {
  const parts: string[] = [];

  if (d.physical_verbal < 3) parts.push('primarily verbal and linguistic');
  else if (d.physical_verbal > 7) parts.push('heavily physical and visual');
  else parts.push('a mix of physical and verbal');

  if (d.safe_provocative < 3) parts.push('clean and family-friendly');
  else if (d.safe_provocative > 7) parts.push('edgy and boundary-pushing');
  else parts.push('adult but broadly accessible');

  if (d.character_observational < 3) parts.push('pure observational — comedy from everyday truth');
  else if (d.character_observational > 7) parts.push('character-driven — inhabiting personas and voices');
  else parts.push('blending observation and character');

  return parts.join('; ');
}

/**
 * Build a style context block for a comedian, loading a profile excerpt
 * from the comedy-taxonomy project files when available.
 */
export function getComedianStyleContext(comedian: ComedianData, comedyProjectPath: string): string {
  const lines: string[] = [];

  lines.push(`Write in the comedic style of ${comedian.name} (${comedian.primary_category}, ${comedian.nationality}).`);
  lines.push(`Style signature: ${describeDimensions(comedian.dimensions)}.`);
  lines.push(`Known for: "${comedian.quote}"`);

  // Load profile excerpt for richer style grounding
  try {
    const profileFile = path.join(comedyProjectPath, 'profiles', `${comedian.id}.md`);
    const raw = fs.readFileSync(profileFile, 'utf8');

    // Skip the "Basic Information" table block; grab from Historical Significance or first substance
    const sigIdx = raw.indexOf('## Historical Significance');
    const content = sigIdx > -1 ? raw.slice(sigIdx) : raw;

    // Strip markdown headings and keep plain text up to ~800 chars
    const excerpt = content
      .replace(/^##[^\n]+\n/gm, '')
      .replace(/\*\*/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 800);

    if (excerpt) {
      lines.push('');
      lines.push('Style context:');
      lines.push(excerpt);
    }
  } catch { /* profile unavailable — name + dimensions are enough */ }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

export function buildJokePrompt(opts: JokeOptions, comedianCtx?: string): string {
  const lines: string[] = [];

  // 1. Comedian style preamble
  if (comedianCtx) {
    lines.push(comedianCtx);
    lines.push('');
  }

  // 2. News / topic sourcing
  if (opts.topic) {
    lines.push(`Search for the latest news about: ${opts.topic}`);
    lines.push('Find the most specific, current, and joke-worthy angle. Prefer concrete situations over vague policy.');
  } else {
    lines.push('Search for today\'s top news headlines. Scan at least 5 stories.');
    lines.push('Pick the single most joke-worthy story — prioritize concrete, absurd, or ironic situations over vague policy headlines.');
  }

  lines.push('');

  // 3. Core joke instruction
  if (comedianCtx) {
    lines.push('Write ONE topical joke in the distinctive style described above.');
  } else {
    lines.push('Write ONE topical joke in the style of a late-night host or SNL\'s Weekend Update.');
    lines.push('Think Tina Fey\'s Weekend Update, Seth Meyers\' "A Closer Look", or Colin Jost — sharp, dry, specific.');
  }

  // 4. Style modifiers
  const styleDesc: string[] = [];
  if (opts.styles.has('dark')) styleDesc.push('edgy and willing to go somewhere uncomfortable');
  if (opts.styles.has('safe')) styleDesc.push('clean and suitable for all audiences');
  if (opts.styles.has('wordplay')) styleDesc.push('built around a pun, double meaning, or clever linguistic twist');
  if (opts.styles.has('absurdist')) styleDesc.push('following the most absurd literal implications of the story as if they are real');
  if (opts.styles.has('observational')) styleDesc.push('rooted in a universal human truth the story reveals');
  if (opts.styles.has('satire')) styleDesc.push('satirical — use irony and exaggeration to indict something larger');

  if (styleDesc.length > 0) {
    lines.push(`Make it ${styleDesc.join(', and ')}.`);
  }

  // 5. Format constraint
  lines.push('');
  lines.push('Format: one setup sentence providing news context, then the punchline (1–2 sentences). 2–3 sentences total. No preamble, no explanation — just deliver the joke.');

  return lines.join('\n');
}
