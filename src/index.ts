/**
 * Green daemon entry point.
 *
 * Usage:
 *   npm run dev:local          # stdin/stdout dev harness (no Signal required)
 *   npm run dev                # connect to signal-cli daemon (default)
 *   npm run dev:gateway        # connect to OpenClaw Gateway
 *
 * Channel is selected by --channel <name>:
 *   local    — stdin/stdout
 *   signal   — signal-cli TCP daemon (default)
 *   gateway  — OpenClaw WebSocket Gateway
 */
import Anthropic from '@anthropic-ai/sdk';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, chunkText } from './config.js';
import { runAgentTurn, clearHistory } from './agent.js';
import { generateBriefing } from './skills/briefing.js';
import { generateBets } from './skills/bets.js';
import { generateIpo } from './skills/ipo.js';
import { processReceiptImage } from './skills/chew/pantry.js';
import { LocalChannel } from './channels/local.js';
import { SignalChannel } from './channels/signal.js';
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

function getChannelArg(): string {
  const idx = process.argv.findIndex(a => a === '--channel' || a.startsWith('--channel='));
  if (idx === -1) return 'signal'; // default
  const arg = process.argv[idx];
  if (arg.startsWith('--channel=')) return arg.slice('--channel='.length);
  return process.argv[idx + 1] ?? 'signal';
}

const channelName = getChannelArg();

function buildChannel(): Channel {
  switch (channelName) {
    case 'local':
      return new LocalChannel();
    case 'gateway':
      return new GatewayChannel(config.openclaw.gateway, config.imessage.approved_numbers);
    case 'signal':
    default:
      return new SignalChannel(config.signal.daemon, config.signal.approved_numbers);
  }
}

const channel: Channel = buildChannel();

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

function resolveAttachmentPath(storedFilename: string): string {
  return path.isAbsolute(storedFilename)
    ? storedFilename
    : path.join(os.homedir(), '.local', 'share', 'signal-cli', 'attachments', storedFilename);
}

async function handleMessage(msg: IncomingMessage): Promise<void> {
  const { senderId } = msg;
  const cmd = msg.text.trim().toLowerCase();

  // Built-in slash commands handled before the agent sees them
  if (cmd === '/reset') {
    clearHistory(senderId);
    await channel.send(senderId, 'Conversation history cleared.');
    return;
  }

  if (cmd === '/projects') {
    const list = config.projects.map(p => `${p.name}: ${p.description}`).join('\n');
    await channel.send(senderId, 'Available projects:\n' + list);
    return;
  }

  if (cmd === '/bets') {
    await channel.send(senderId, 'Scanning markets...');
    try {
      const briefing = await generateBets(client);
      for (const chunk of chunkText(briefing, config.claude_code.chunk_size)) {
        await channel.send(senderId, chunk);
      }
    } catch (err) {
      await channel.send(senderId, `Bets failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (cmd === '/ipo') {
    await channel.send(senderId, 'Researching IPO pipeline...');
    try {
      const briefing = await generateIpo(client);
      for (const chunk of chunkText(briefing, config.claude_code.chunk_size)) {
        await channel.send(senderId, chunk);
      }
    } catch (err) {
      await channel.send(senderId, `IPO lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (cmd === '/chew') {
    const attachment = msg.attachments?.[0];
    if (!attachment) {
      await channel.send(senderId, 'No attachment found. Send /chew with an image attached.');
      return;
    }
    const imagePath = resolveAttachmentPath(attachment.storedFilename);
    console.log(`[chew] storedFilename=${attachment.storedFilename} imagePath=${imagePath}`);
    await channel.send(senderId, 'Analysing image...');
    try {
      // TODO: restore routeChewImage() once modules beyond pantry are implemented.
      // Currently all routes fall back to pantry, so routing is a redundant API call.
      const result = await processReceiptImage(imagePath, config.chew.url);
      console.log('[chew] processReceiptImage returned:', result.slice(0, 120));
      await channel.send(senderId, result);
    } catch (err) {
      console.error('[chew] error:', err instanceof Error ? err.message : String(err));
      await channel.send(senderId, `Chew failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (cmd === '/briefing') {
    try {
      const briefing = await generateBriefing(config);
      await channel.send(senderId, briefing);
    } catch (err) {
      await channel.send(senderId, `Briefing failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (cmd === '/help') {
    await channel.send(senderId, [
      'Green — personal AI assistant',
      '',
      'Slash commands:',
      '  /help           — this message',
      '  /reset          — clear conversation history for this session',
      '  /projects       — list Claude Code projects available on this machine',
      '  /briefing       — instant system briefing: git activity (24h), service',
      '                    health, disk usage, and uptime across all projects',
      '  /bets           — daily market briefing: top movers, macro theme, key takeaway',
      '  /ipo            — upcoming IPO pipeline with predicted open and day-1 close prices',
      '  /chew           — attach any food image; Green routes it to the right Chew module',
      '',
      'Chat naturally for everything else:',
      '  - Ask questions about code in any configured project',
      '  - Request changes ("add a README to green")',
      '  - Debug issues ("why are the tests failing in chew?")',
      '  - Search the web ("what changed in Node 22?")',
      '  - Fetch a URL ("summarise https://...")',
      '  - Ask for a status update ("give me a briefing")',
      '',
      'A daily briefing is also sent automatically at 08:00.',
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
const channelDesc: Record<string, string> = {
  local: 'local (stdin/stdout)',
  signal: `Signal via signal-cli at ${config.signal.daemon}`,
  gateway: `OpenClaw Gateway at ${config.openclaw.gateway}`,
};
console.log(`Channel: ${channelDesc[channelName] ?? channelName}`);
console.log(`Projects: ${config.projects.map(p => p.name).join(', ')}`);

const stop = channel.listen(handleMessage);

// Graceful shutdown
process.on('SIGINT', () => { stop(); process.exit(0); });
process.on('SIGTERM', () => { stop(); process.exit(0); });
