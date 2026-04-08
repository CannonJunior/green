/**
 * Chew Pantry skill — processes a receipt image via the Claude Code subprocess
 * (Pro quota, no API cost) and saves the parsed items to Chew.
 *
 * Flow:
 *   1. POST image to Chew /api/pantry/receipts/record  → get { id, imagePath (absolute) }
 *   2. runClaudeCode subprocess reads the image → returns JSON items
 *   3. POST items to Chew /api/pantry/receipts/:id/items
 */
import fs from 'node:fs';
import path from 'node:path';
import { runClaudeCode } from '../claude-code.js';
import { getProject } from '../../config.js';
import type { Config } from '../../config.js';

interface ParsedItem {
  name: string;
  quantity: number | null;
  unit: string | null;
  category: string;
}

interface RecordResponse {
  id: string;
  imagePath: string; // absolute path on disk
}

export async function processReceiptImage(
  imagePath: string,
  chewUrl: string,
  config: Config,
): Promise<string> {
  console.log(`[chew/pantry] processReceiptImage imagePath=${imagePath} chewUrl=${chewUrl}`);

  // Step 1: Read the attachment and POST to Chew to create the receipt record
  let fileBuffer: Buffer;
  try {
    fileBuffer = fs.readFileSync(imagePath);
    console.log(`[chew/pantry] image read OK (${Math.round(fileBuffer.length / 1024)} KB)`);
  } catch (err) {
    return `Could not read image file: ${err instanceof Error ? err.message : String(err)}`;
  }

  const filename = path.basename(imagePath);
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.webp': 'image/webp', '.heic': 'image/heic',
  };
  const contentType = mimeTypes[ext] ?? 'image/jpeg';

  const formData = new FormData();
  formData.append('file', new Blob([new Uint8Array(fileBuffer)], { type: contentType }), filename);

  let record: RecordResponse;
  try {
    console.log(`[chew/pantry] POST ${chewUrl}/api/pantry/receipts/record`);
    const res = await fetch(`${chewUrl}/api/pantry/receipts/record`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return `Chew record error ${res.status}: ${body.slice(0, 200)}`;
    }
    record = await res.json() as RecordResponse;
    console.log(`[chew/pantry] record id=${record.id} imagePath=${record.imagePath}`);
  } catch (err) {
    return `Could not reach Chew at ${chewUrl}: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Step 2: Parse the image via Claude Code subprocess (uses Pro quota)
  const project =
    getProject(config, 'chew') ??
    getProject(config, 'green') ??
    config.projects[0];

  if (!project) {
    return 'No project configured — cannot run receipt parser.';
  }

  const parsePrompt = [
    `Read the image at this path: ${record.imagePath}`,
    '',
    'Extract every grocery or food item visible on this receipt.',
    'Return ONLY a JSON array — no markdown, no explanation, no code fences.',
    'Each element must have exactly these fields:',
    '  name: string (the item name, cleaned up)',
    '  quantity: number or null',
    '  unit: string or null (e.g. "kg", "L", "pack") ',
    '  category: one of: produce, meat, seafood, dairy, frozen, beverage, pantry, other',
    '',
    'Example output:',
    '[{"name":"Whole Milk","quantity":2,"unit":"L","category":"dairy"},{"name":"Bananas","quantity":null,"unit":null,"category":"produce"}]',
    '',
    'If no items are found, return an empty array: []',
  ].join('\n');

  console.log('[chew/pantry] running Claude Code subprocess for receipt parsing');
  const result = await runClaudeCode(project, parsePrompt, config);

  if (!result.success) {
    console.error(`[chew/pantry] subprocess failed (exit ${result.exit_code}): ${result.output.slice(0, 200)}`);
    return `Receipt saved but parsing failed. Open Chew to add items manually. (${result.output.slice(0, 100)})`;
  }

  // Extract JSON from output (strip any leading/trailing text)
  let items: ParsedItem[];
  try {
    const match = result.output.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array found in output');
    items = JSON.parse(match[0]) as ParsedItem[];
  } catch (err) {
    console.error('[chew/pantry] JSON parse error:', err, '\nOutput:', result.output.slice(0, 300));
    return `Receipt saved but could not parse items. Open Chew to add items manually.`;
  }

  console.log(`[chew/pantry] parsed ${items.length} items`);

  if (items.length === 0) {
    return 'Receipt uploaded but no items were found. Open Chew to add items manually.';
  }

  // Step 3: Save items to Chew database
  try {
    console.log(`[chew/pantry] POST ${chewUrl}/api/pantry/receipts/${record.id}/items (${items.length} items)`);
    const saveRes = await fetch(`${chewUrl}/api/pantry/receipts/${record.id}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!saveRes.ok) {
      return `Items parsed but save failed (${saveRes.status}). Open Chew to review.`;
    }
  } catch (err) {
    return `Items parsed but save failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Format summary grouped by category
  const byCategory = new Map<string, string[]>();
  for (const item of items) {
    const cat = item.category ?? 'other';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    const qty = item.quantity != null
      ? `${item.quantity}${item.unit ? ' ' + item.unit : ''} `
      : '';
    byCategory.get(cat)!.push(`${qty}${item.name}`);
  }

  const categoryOrder = ['produce', 'meat', 'seafood', 'dairy', 'frozen', 'beverage', 'pantry', 'other'];
  const lines: string[] = [`Pantry updated — ${items.length} items saved to Chew.`];
  for (const cat of categoryOrder) {
    const itemList = byCategory.get(cat);
    if (itemList?.length) {
      lines.push(`${cat.charAt(0).toUpperCase() + cat.slice(1)}: ${itemList.join(', ')}`);
    }
  }

  return lines.join('\n');
}
