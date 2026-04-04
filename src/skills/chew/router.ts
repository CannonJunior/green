/**
 * Chew image router — uses Claude vision to classify an incoming image and
 * determine which Chew module should handle it.
 *
 * Current modules:
 *   pantry   — grocery receipts, shopping lists, pantry inventory photos
 *   recipes  — recipe cards, cookbook pages, plated dishes to recreate
 *   kitchen  — equipment photos, appliances, tools, kitchen layout
 *   wiki     — single ingredient close-ups for identification/lookup
 *   yeschef  — general food photos that warrant a culinary conversation
 *
 * As new modules are implemented, add them to ChewModule and extend the
 * CLASSIFICATION_PROMPT accordingly.
 */
import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';

export type ChewModule = 'pantry' | 'recipes' | 'kitchen' | 'wiki' | 'yeschef' | 'unknown';

export interface ChewRouterResult {
  module: ChewModule;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

const CLASSIFICATION_PROMPT = `You are classifying an image sent to the Chew food intelligence app to determine which module should handle it.

Modules:
- pantry: grocery store receipts, shopping lists, or photos of pantry/fridge contents for inventory tracking
- recipes: recipe cards, cookbook pages, handwritten recipes, or photos of a finished dish the user wants to recreate
- kitchen: kitchen equipment, appliances, tools, or a photo of a kitchen layout
- wiki: a close-up of a single ingredient for identification or nutritional lookup
- yeschef: general food or meal photos, restaurant dishes, food inspiration — best handled by the AI chef assistant
- unknown: cannot determine from the image

Respond with ONLY a JSON object, no other text:
{"module":"<module>","confidence":"<high|medium|low>","reason":"<one sentence>"}`;

export async function routeChewImage(
  client: Anthropic,
  imagePath: string,
): Promise<ChewRouterResult> {
  console.log(`[chew/router] reading image: ${imagePath}`);
  let imageData: string;
  try {
    imageData = fs.readFileSync(imagePath).toString('base64');
    console.log(`[chew/router] image read OK (${Math.round(imageData.length * 0.75 / 1024)} KB)`);
  } catch (err) {
    console.error('[chew/router] failed to read image:', err instanceof Error ? err.message : String(err));
    return { module: 'unknown', confidence: 'low', reason: 'Could not read image file.' };
  }

  // Detect media type from file header
  const buf = Buffer.alloc(4);
  const fd = fs.openSync(imagePath, 'r');
  fs.readSync(fd, buf, 0, 4, 0);
  fs.closeSync(fd);

  let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) mediaType = 'image/png';
  else if (buf[0] === 0x47 && buf[1] === 0x49) mediaType = 'image/gif';
  else if (buf[0] === 0x52 && buf[1] === 0x49) mediaType = 'image/webp';
  console.log(`[chew/router] detected mediaType: ${mediaType}`);

  try {
    console.log('[chew/router] sending classification request to Claude');
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: imageData },
          },
          { type: 'text', text: CLASSIFICATION_PROMPT },
        ],
      }],
    });

    const text = response.content.find(b => b.type === 'text')?.text ?? '';
    console.log(`[chew/router] Claude response: ${text.slice(0, 200)}`);
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');
    const result = JSON.parse(match[0]) as ChewRouterResult;
    console.log(`[chew/router] parsed result: module=${result.module} confidence=${result.confidence}`);
    return result;
  } catch (err) {
    console.error('[chew/router] classification error:', err instanceof Error ? err.message : String(err));
    return { module: 'unknown', confidence: 'low', reason: 'Classification failed.' };
  }
}
