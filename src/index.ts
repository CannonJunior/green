/**
 * Green daemon entry point.
 *
 * Usage:
 *   npm run dev:local          # stdin/stdout dev harness
 *   npm run dev                # connect to OpenClaw Gateway (iMessage)
 */
import Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from './config.js';
import { runAgentTurn, clearHistory } from './agent.js';
import { LocalChannel } from './channels/local.js';
import { GatewayChannel } from './channels/gateway.js';
import type { Channel, IncomingMessage } from './channels/types.js';

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const config = loadConfig();

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.');
  process.exit(1);
}

const client = new Anthropic({ apiKey });

// ---------------------------------------------------------------------------
// Channel selection
// ---------------------------------------------------------------------------

const useLocal = process.argv.includes('--channel') &&
  process.argv[process.argv.indexOf('--channel') + 1] === 'local' ||
  process.argv.includes('--channel=local');

const channel: Channel = useLocal
  ? new LocalChannel()
  : new GatewayChannel(config.openclaw.gateway, config.imessage.approved_numbers);

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

async function handleMessage(msg: IncomingMessage): Promise<void> {
  const { senderId, text } = msg;

  // Built-in slash commands handled before the agent sees them
  if (text.trim().toLowerCase() === '/reset') {
    clearHistory(senderId);
    await channel.send(senderId, 'Conversation history cleared.');
    return;
  }

  if (text.trim().toLowerCase() === '/projects') {
    const list = config.projects.map(p => `${p.name}: ${p.description}`).join('\n');
    await channel.send(senderId, 'Available projects:\n' + list);
    return;
  }

  if (text.trim().toLowerCase() === '/help') {
    await channel.send(senderId, [
      'Green commands:',
      '  /reset    — clear conversation history',
      '  /projects — list available Claude Code projects',
      '  /help     — this message',
      '',
      'Or just chat normally. To run Claude Code say e.g.:',
      '  "why are the tests failing in green?"',
      '  "add a README to the green project"',
    ].join('\n'));
    return;
  }

  // Send a quick acknowledgement for messages that will take time
  // (the agent will send a more specific one if it decides to call Claude Code)
  let replied = false;

  try {
    const chunks = await runAgentTurn(senderId, text, config, client);
    for (const chunk of chunks) {
      await channel.send(senderId, chunk);
      replied = true;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[green] agent error:', message);
    if (!replied) {
      await channel.send(senderId, `Something went wrong: ${message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

console.log(`Green v${(await import('../package.json', { with: { type: 'json' } })).default.version} starting`);
console.log(`Channel: ${useLocal ? 'local (stdin/stdout)' : 'OpenClaw Gateway at ' + config.openclaw.gateway}`);
console.log(`Projects: ${config.projects.map(p => p.name).join(', ')}`);

const stop = channel.listen(handleMessage);

// Graceful shutdown
process.on('SIGINT', () => { stop(); process.exit(0); });
process.on('SIGTERM', () => { stop(); process.exit(0); });
