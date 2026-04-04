/**
 * Chew Pantry skill — submits a receipt image to Chew's Pantry API,
 * auto-saves the parsed items, and returns a human-readable summary.
 *
 * Mirrors the "Drag & drop a receipt photo" flow in PantryClient.tsx:
 *   POST /api/pantry/receipts          → parse image → get items
 *   POST /api/pantry/receipts/:id/items → commit items to database
 */
import fs from 'node:fs';
import path from 'node:path';

interface ParsedItem {
  name: string;
  quantity: number | null;
  unit: string | null;
  category: string;
}

interface ReceiptResponse {
  id: string;
  imagePath: string;
  items: ParsedItem[];
  warning?: string;
}

export async function processReceiptImage(
  imagePath: string,
  chewUrl: string,
): Promise<string> {
  console.log(`[chew/pantry] processReceiptImage imagePath=${imagePath} chewUrl=${chewUrl}`);
  // Read attachment from signal-cli storage
  let fileBuffer: Buffer;
  try {
    fileBuffer = fs.readFileSync(imagePath);
    console.log(`[chew/pantry] image read OK (${Math.round(fileBuffer.length / 1024)} KB)`);
  } catch (err) {
    console.error('[chew/pantry] failed to read image:', err instanceof Error ? err.message : String(err));
    return `Could not read image file: ${err instanceof Error ? err.message : String(err)}`;
  }

  const filename = path.basename(imagePath);
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.webp': 'image/webp', '.heic': 'image/heic',
  };
  const contentType = mimeTypes[ext] ?? 'image/jpeg';
  console.log(`[chew/pantry] filename=${filename} ext=${ext} contentType=${contentType}`);

  // POST to Chew's receipt endpoint
  const formData = new FormData();
  formData.append('file', new Blob([new Uint8Array(fileBuffer)], { type: contentType }), filename);

  let receipt: ReceiptResponse;
  try {
    console.log(`[chew/pantry] POST ${chewUrl}/api/pantry/receipts`);
    const res = await fetch(`${chewUrl}/api/pantry/receipts`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(600_000), // CPU vision inference can be very slow
    });
    console.log(`[chew/pantry] POST /api/pantry/receipts → status ${res.status}`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[chew/pantry] API error ${res.status}: ${body.slice(0, 200)}`);
      return `Chew API error ${res.status}: ${body.slice(0, 200)}`;
    }
    receipt = await res.json() as ReceiptResponse;
    console.log(`[chew/pantry] receipt id=${receipt.id} items=${receipt.items.length} warning=${receipt.warning ?? 'none'}`);
  } catch (err) {
    console.error('[chew/pantry] fetch error:', err instanceof Error ? err.message : String(err));
    return `Could not reach Chew at ${chewUrl} — is it running? (${err instanceof Error ? err.message : String(err)})`;
  }

  if (receipt.warning) {
    return `Chew warning: ${receipt.warning}`;
  }

  if (receipt.items.length === 0) {
    return 'Receipt uploaded but no items were parsed. Check the Pantry tab in Chew to add items manually.';
  }

  // Auto-save parsed items to the database
  try {
    console.log(`[chew/pantry] POST ${chewUrl}/api/pantry/receipts/${receipt.id}/items (${receipt.items.length} items)`);
    const saveRes = await fetch(`${chewUrl}/api/pantry/receipts/${receipt.id}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: receipt.items }),
      signal: AbortSignal.timeout(15_000),
    });
    console.log(`[chew/pantry] save items → status ${saveRes.status}`);
    if (!saveRes.ok) {
      return `Items parsed but save failed (${saveRes.status}). Open Chew to review.`;
    }
  } catch (err) {
    console.error('[chew/pantry] save error:', err instanceof Error ? err.message : String(err));
    return `Items parsed but save failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Format summary grouped by category
  const byCategory = new Map<string, string[]>();
  for (const item of receipt.items) {
    const cat = item.category ?? 'other';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    const qty = item.quantity != null
      ? `${item.quantity}${item.unit ? ' ' + item.unit : ''} `
      : '';
    byCategory.get(cat)!.push(`${qty}${item.name}`);
  }

  const categoryOrder = ['produce', 'meat', 'seafood', 'dairy', 'frozen', 'beverage', 'pantry', 'other'];
  const lines: string[] = [`Pantry updated — ${receipt.items.length} items saved to Chew.`];
  for (const cat of categoryOrder) {
    const items = byCategory.get(cat);
    if (items?.length) {
      lines.push(`${cat.charAt(0).toUpperCase() + cat.slice(1)}: ${items.join(', ')}`);
    }
  }

  return lines.join('\n');
}
