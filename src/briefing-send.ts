/**
 * Standalone script: generate a briefing and send it to the approved number
 * via signal-cli. Intended to be run by a systemd timer.
 *
 * Usage:
 *   node dist/briefing-send.js
 */
import { spawn } from 'node:child_process';
import { loadConfig } from './config.js';
import { generateBriefing } from './skills/briefing.js';

const config = loadConfig();
const recipient = config.signal.approved_numbers[0];

if (!recipient) {
  console.error('No approved number configured — cannot send briefing.');
  process.exit(1);
}

const text = await generateBriefing(config);
console.log('[briefing] Sending to', recipient);

const proc = spawn(
  'signal-cli',
  ['-a', recipient, 'send', '-m', text, recipient],
  { stdio: 'inherit' },
);

proc.on('close', code => {
  if (code !== 0) {
    console.error('[briefing] signal-cli exited with code', code);
    process.exit(code ?? 1);
  }
  console.log('[briefing] Sent.');
});
