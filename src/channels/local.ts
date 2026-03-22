/**
 * Local channel — reads from stdin, writes to stdout.
 * Used for development and testing without BlueBubbles or OpenClaw.
 *
 * Usage:
 *   npm run dev:local
 *
 * Type a message and press Enter. Green's reply is printed to stdout.
 * Type "/reset" to clear conversation history.
 * Ctrl-C to quit.
 */
import readline from 'node:readline';
import type { Channel, IncomingMessage } from './types.js';

export class LocalChannel implements Channel {
  async send(_senderId: string, text: string): Promise<void> {
    process.stdout.write('\nGreen: ' + text + '\n\n');
  }

  listen(onMessage: (msg: IncomingMessage) => Promise<void>): () => void {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'You: ',
      terminal: true,
    });

    rl.prompt();

    rl.on('line', async (line) => {
      const text = line.trim();
      if (!text) {
        rl.prompt();
        return;
      }
      try {
        await onMessage({ senderId: 'local', text });
      } catch (err) {
        console.error('[local channel error]', err);
      }
      rl.prompt();
    });

    rl.on('close', () => {
      console.log('\nBye.');
      process.exit(0);
    });

    return () => rl.close();
  }
}
