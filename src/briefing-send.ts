/**
 * Standalone script: generate a briefing and send it to the approved number
 * via the running signal-cli daemon (TCP JSON-RPC). Intended to be run by a
 * systemd timer.
 *
 * Uses the daemon rather than spawning signal-cli directly so that no account
 * number needs to be configured separately — the daemon is already bound to
 * the correct account.
 *
 * Usage:
 *   node dist/briefing-send.js
 */
import net from 'node:net';
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

const [host, portStr] = config.signal.daemon.split(':');
const port = parseInt(portStr ?? '7583', 10);

await new Promise<void>((resolve, reject) => {
  const socket = net.createConnection({ host: host ?? '127.0.0.1', port });

  socket.setEncoding('utf8');
  let buffer = '';
  let id = 1;

  socket.on('connect', () => {
    // Send the message
    const frame = JSON.stringify({
      jsonrpc: '2.0',
      method: 'send',
      params: { recipient: [recipient], message: text },
      id: id++,
    });
    socket.write(frame + '\n');
  });

  socket.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as { id?: number; result?: unknown; error?: { message: string } };
        if ('id' in msg) {
          if (msg.error) {
            socket.destroy();
            reject(new Error(`signal-cli error: ${msg.error.message}`));
          } else {
            console.log('[briefing] Sent.');
            socket.destroy();
            resolve();
          }
        }
      } catch {
        // ignore unparseable lines
      }
    }
  });

  socket.on('error', (err) => reject(err));
  socket.on('close', () => resolve()); // resolve on close in case response arrived before close event
});
