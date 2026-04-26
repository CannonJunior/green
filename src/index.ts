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
import { loadConfig, chunkText, getProject } from './config.js';
import { runClaudeCode } from './skills/claude-code.js';
import { runAgentTurn, clearHistory } from './agent.js';
import { runSubprocessAgentTurn, clearSubprocessHistory } from './skills/subprocess-agent.js';
import { generateBriefing } from './skills/briefing.js';
import { getHelp } from './help.js';
import { generateBets, generateIpo, generateIpoSymbols, handleAlpha, runAlphaDaily } from 'bets';
// runAlphaDaily is imported here for the future daily cron job; see CLAUDE.md
import { generateBest, getDefaultLocation, setDefaultLocation, isValidZipCode } from 'best';
import { generateTrip, getDefaultOrigin, setDefaultOrigin } from 'trip';
import { routeChewImage, processReceiptImage, processEquipmentImage } from 'chew';
import { addEntry, summarizeEntries, searchEntries } from 'log';
import { LocalChannel } from './channels/local.js';
import { SignalChannel } from './channels/signal.js';
import { GatewayChannel } from './channels/gateway.js';
import { MobileChannel } from './channels/mobile.js';
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
    case 'mobile':
      return new MobileChannel(
        config.mobile?.token ?? 'changeme',
        config.mobile?.port,
      );
    case 'signal':
    default:
      return new SignalChannel(config.signal.daemon, config.signal.approved_numbers);
  }
}

const channel: Channel = buildChannel();

// Pricing: claude-sonnet-4-6 as of April 2026 (verify at console.anthropic.com)
const INPUT_COST_PER_TOKEN = 3.00 / 1_000_000;
const OUTPUT_COST_PER_TOKEN = 15.00 / 1_000_000;

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
    clearSubprocessHistory(senderId);
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
      const text = await generateBets(apiKey!, config.inference.model);
      for (const chunk of chunkText(text, config.claude_code.chunk_size)) {
        await channel.send(senderId, chunk);
      }
    } catch (err) {
      await channel.send(senderId, `Bets failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (cmd === '/alpha' || cmd.startsWith('/alpha ')) {
    const alphaArg = msg.text.trim().slice('/alpha'.length).trim();
    await channel.send(senderId, alphaArg ? `Analyzing ${alphaArg}...` : 'Checking today\'s earnings...');
    try {
      const text = await handleAlpha(alphaArg, client, config.inference.model);
      for (const chunk of chunkText(text, config.claude_code.chunk_size)) {
        await channel.send(senderId, chunk);
      }
    } catch (err) {
      await channel.send(senderId, `/alpha failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (cmd === '/ipo' || cmd.startsWith('/ipo ')) {
    const ipoArg = msg.text.trim().slice('/ipo'.length).trim();

    // -symbols / -s: return compact ticker list only
    if (ipoArg === '-symbols' || ipoArg === '-s') {
      await channel.send(senderId, 'Fetching upcoming IPO symbols...');
      try {
        const text = await generateIpoSymbols(apiKey!, config.inference.model);
        for (const chunk of chunkText(text, config.claude_code.chunk_size)) {
          await channel.send(senderId, chunk);
        }
      } catch (err) {
        await channel.send(senderId, `/ipo -symbols failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    // -d YYYYMMDD: full pipeline for a specific date
    let ipoDate: string | undefined;
    if (ipoArg.startsWith('-d ')) {
      const dateStr = ipoArg.slice('-d '.length).trim().split(/\s/)[0];
      if (/^\d{8}$/.test(dateStr)) {
        ipoDate = dateStr;
      } else {
        await channel.send(senderId, 'Invalid date format. Use: /ipo -d YYYYMMDD');
        return;
      }
    }

    // bare tickers: /ipo OKLO or /ipo OKLO,TSLA
    let ipoSymbols: string[] | undefined;
    if (!ipoDate && ipoArg) {
      const symbols = ipoArg.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      if (symbols.length > 0) ipoSymbols = symbols;
    }

    let statusMsg: string;
    if (ipoSymbols) {
      statusMsg = `Researching IPO${ipoSymbols.length > 1 ? 's' : ''}: ${ipoSymbols.join(', ')}...`;
    } else if (ipoDate) {
      statusMsg = `Researching IPOs on or about ${ipoDate.slice(0, 4)}-${ipoDate.slice(4, 6)}-${ipoDate.slice(6, 8)}...`;
    } else {
      statusMsg = 'Researching IPO pipeline...';
    }
    await channel.send(senderId, statusMsg);
    try {
      const text = await generateIpo(apiKey!, config.inference.model, ipoDate, ipoSymbols);
      for (const chunk of chunkText(text, config.claude_code.chunk_size)) {
        await channel.send(senderId, chunk);
      }
    } catch (err) {
      await channel.send(senderId, `IPO lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (cmd === '/best' || cmd.startsWith('/best ')) {
    const arg = msg.text.trim().slice('/best'.length).trim();

    if (arg.startsWith('-default ')) {
      const zip = arg.slice('-default '.length).trim();
      if (!isValidZipCode(zip)) {
        await channel.send(senderId, 'Invalid zip code. Use 5 digits: /best -default 22201');
        return;
      }
      setDefaultLocation(zip);
      await channel.send(senderId, `Default location set to ${zip}.`);
      return;
    }

    let dateContext: string | undefined;
    let locationArg = arg;

    const dFlagMatch = arg.match(/(^|\s)-d\s+(\d{8})(\s|$)/);
    if (dFlagMatch) {
      const raw = dFlagMatch[2];
      const year = parseInt(raw.slice(0, 4), 10);
      const month = parseInt(raw.slice(4, 6), 10) - 1;
      const day = parseInt(raw.slice(6, 8), 10);
      const date = new Date(year, month, day);
      if (isNaN(date.getTime()) || date.getMonth() !== month) {
        await channel.send(senderId, 'Invalid date. Use YYYYMMDD format: /best -d 20260418');
        return;
      }
      dateContext = date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      locationArg = arg.replace(dFlagMatch[0], dFlagMatch[1]).trim();
    }

    const location = locationArg || getDefaultLocation() || config.green.location || '';
    if (!location) {
      await channel.send(senderId, 'No default set. Use /best <zip> or set one with /best -default 22201');
      return;
    }
    await channel.send(senderId, `Searching for the best of ${location}...`);
    try {
      const text = await generateBest(client, config.inference.model, location, dateContext);
      for (const chunk of chunkText(text, config.claude_code.chunk_size)) {
        await channel.send(senderId, chunk);
      }
    } catch (err) {
      await channel.send(senderId, `/best failed: ${err instanceof Error ? err.message : String(err)}`);
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
    await channel.send(senderId, 'Classifying image...');
    try {
      const chewProject = getProject(config, 'chew') ?? getProject(config, 'green') ?? config.projects[0];
      const runPrompt = (prompt: string) => runClaudeCode(chewProject!, prompt, config);
      const route = await routeChewImage(apiKey!, imagePath, config.inference.model);
      console.log(`[chew] routed to module=${route.module} confidence=${route.confidence}`);
      if (route.module === 'kitchen') {
        await channel.send(senderId, 'Kitchen equipment detected — identifying...');
        const result = await processEquipmentImage(imagePath, config.chew.url, runPrompt);
        await channel.send(senderId, result);
      } else {
        if (route.module !== 'pantry') {
          await channel.send(senderId, `Treating as pantry (detected: ${route.module}, ${route.reason})`);
        }
        await channel.send(senderId, 'Processing receipt...');
        const result = await processReceiptImage(imagePath, config.chew.url, runPrompt);
        await channel.send(senderId, result);
      }
    } catch (err) {
      console.error('[chew] error:', err instanceof Error ? err.message : String(err));
      await channel.send(senderId, `Chew failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (cmd === '/equipment') {
    const attachment = msg.attachments?.[0];
    if (!attachment) {
      await channel.send(senderId, 'No attachment found. Send /equipment with a photo of a kitchen item.');
      return;
    }
    const imagePath = resolveAttachmentPath(attachment.storedFilename);
    console.log(`[equipment] storedFilename=${attachment.storedFilename} imagePath=${imagePath}`);
    await channel.send(senderId, 'Identifying kitchen equipment...');
    try {
      const chewProject = getProject(config, 'chew') ?? getProject(config, 'green') ?? config.projects[0];
      const runPrompt = (prompt: string) => runClaudeCode(chewProject!, prompt, config);
      const result = await processEquipmentImage(imagePath, config.chew.url, runPrompt);
      console.log('[equipment] processEquipmentImage returned:', result.slice(0, 120));
      await channel.send(senderId, result);
    } catch (err) {
      console.error('[equipment] error:', err instanceof Error ? err.message : String(err));
      await channel.send(senderId, `Equipment failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (cmd === '/morning') {
    await channel.send(senderId, 'Good morning. Preparing your briefing...');
    try {
      const health = msg.metadata as {
        sleep_hours?: number;
        hrv?: number;
        steps_yesterday?: number;
        resting_hr?: number;
      } | undefined;

      const healthLines: string[] = [];
      if (health?.sleep_hours != null) healthLines.push(`Sleep: ${health.sleep_hours.toFixed(1)}h`);
      if (health?.hrv != null) healthLines.push(`HRV: ${Math.round(health.hrv)}ms`);
      if (health?.steps_yesterday != null) healthLines.push(`Steps yesterday: ${Math.round(health.steps_yesterday).toLocaleString()}`);
      if (health?.resting_hr != null) healthLines.push(`Resting HR: ${Math.round(health.resting_hr)}bpm`);

      const healthContext = healthLines.length > 0
        ? `Health data from iPhone: ${healthLines.join(', ')}.`
        : '';

      const location = config.green.location ?? 'my area';
      const prompt = [
        `Generate a concise, friendly morning briefing for ${config.green.name}.`,
        healthContext,
        `Search for current weather in ${location} and briefly note anything locally relevant today.`,
        'Keep the total response to 4–6 sentences. Conversational, not bullet points.',
      ].filter(Boolean).join(' ');

      const result = await runAgentTurn(senderId, prompt, config, client);
      for (const chunk of result.chunks) {
        await channel.send(senderId, chunk);
      }
    } catch (err) {
      await channel.send(senderId, `Morning briefing failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (cmd === '/clip' || cmd.startsWith('/clip ')) {
    const clipContent = (msg.metadata as { content?: string } | undefined)?.content
      ?? msg.text.trim().slice('/clip'.length).trim();

    if (!clipContent) {
      await channel.send(senderId, 'Usage: /clip <content>  or send clipboard via the Blue app.');
      return;
    }

    await channel.send(senderId, 'Processing...');
    try {
      const prompt = [
        'The user sent this content from their clipboard. Identify what it is and do something useful:',
        '- URL → fetch and summarize in 5 bullets with a one-sentence verdict',
        '- Address → find what\'s nearby and any upcoming events',
        '- Code snippet → explain what it does concisely',
        '- Recipe → check against the Chew pantry and note what\'s missing',
        '- Any other text → summarize and extract the key points',
        '',
        `Content:\n${clipContent}`,
      ].join('\n');

      const result = await runAgentTurn(senderId, prompt, config, client);
      for (const chunk of result.chunks) {
        await channel.send(senderId, chunk);
      }
    } catch (err) {
      await channel.send(senderId, `Clip failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (cmd === '/mood' || cmd.startsWith('/mood ')) {
    const moodArg = msg.text.trim().slice('/mood'.length).trim();
    if (!moodArg) {
      await channel.send(senderId, 'Usage: /mood <1–5 or emoji> [note]  e.g. /mood 4 great run this morning');
      return;
    }
    try {
      const result = await addEntry(`Mood: ${moodArg}`);
      await channel.send(senderId, result.message.replace('Logged.', `Mood logged: ${moodArg}.`));
    } catch (err) {
      await channel.send(senderId, `Mood log failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (cmd === '/log' || cmd.startsWith('/log ')) {
    const arg = msg.text.trim().slice('/log'.length).trim();

    // Summarize sub-commands
    if (arg === 'today' || arg === 'week' || arg === 'month') {
      await channel.send(senderId, `Summarizing ${arg}'s entries...`);
      try {
        const summary = await summarizeEntries(apiKey!, config.inference.model, arg as 'today' | 'week' | 'month');
        await channel.send(senderId, summary);
      } catch (err) {
        await channel.send(senderId, `Log summary failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    // Search sub-command
    if (arg.startsWith('search ')) {
      const query = arg.slice('search '.length).trim();
      if (!query) {
        await channel.send(senderId, 'Usage: /log search <term>');
        return;
      }
      await channel.send(senderId, 'Searching log...');
      try {
        const results = await searchEntries(apiKey!, config.inference.model, query);
        await channel.send(senderId, results);
      } catch (err) {
        await channel.send(senderId, `Log search failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    // Map sub-command
    if (arg === 'map') {
      await channel.send(senderId, 'Map: http://localhost:9001 (run "npm run map" in Project Log to start)');
      return;
    }

    // Add entry: optional text + optional image attachment
    const text = arg || null;
    const attachment = msg.attachments?.[0];
    const imagePath = attachment ? resolveAttachmentPath(attachment.storedFilename) : undefined;

    if (!text && !imagePath) {
      await channel.send(senderId, [
        'Usage:',
        '  /log <text>          — add a text entry',
        '  /log <text> + image  — add entry with image (attach to message)',
        '  /log today/week/month — summarize entries',
        '  /log search <term>   — search entries',
        '  /log map             — map URL for geotagged images',
      ].join('\n'));
      return;
    }

    try {
      const result = await addEntry(text, imagePath);
      await channel.send(senderId, result.message);
    } catch (err) {
      await channel.send(senderId, `Log failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (cmd === '/trip' || cmd.startsWith('/trip ')) {
    const arg = msg.text.trim().slice('/trip'.length).trim();

    if (arg.startsWith('-default ')) {
      const zip = arg.slice('-default '.length).trim();
      if (!isValidZipCode(zip)) {
        await channel.send(senderId, 'Invalid zip code. Use 5 digits: /trip -default 22101');
        return;
      }
      setDefaultOrigin(zip);
      await channel.send(senderId, `Default origin set to ${zip}.`);
      return;
    }

    let dateContext: string | undefined;
    let locationArg = arg;

    const dFlagMatch = arg.match(/(^|\s)-d\s+(\d{8})(\s|$)/);
    if (dFlagMatch) {
      const raw = dFlagMatch[2];
      const year = parseInt(raw.slice(0, 4), 10);
      const month = parseInt(raw.slice(4, 6), 10) - 1;
      const day = parseInt(raw.slice(6, 8), 10);
      const date = new Date(year, month, day);
      if (isNaN(date.getTime()) || date.getMonth() !== month) {
        await channel.send(senderId, 'Invalid date. Use YYYYMMDD format: /trip 90210 -d 20260501');
        return;
      }
      dateContext = date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      locationArg = arg.replace(dFlagMatch[0], dFlagMatch[1]).trim();
    }

    const destination = locationArg;
    if (!destination) {
      await channel.send(senderId, 'Usage: /trip <destination zip>  e.g. /trip 90210\nOptional: /trip 90210 -d 20260501\nSet default origin: /trip -default 22101');
      return;
    }

    const origin = getDefaultOrigin();
    await channel.send(senderId, `Planning trip from ${origin} to ${destination}...`);
    try {
      const text = await generateTrip(client, config.inference.model, origin, destination, dateContext);
      for (const chunk of chunkText(text, config.claude_code.chunk_size)) {
        await channel.send(senderId, chunk);
      }
    } catch (err) {
      await channel.send(senderId, `/trip failed: ${err instanceof Error ? err.message : String(err)}`);
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

  if (cmd === '/help' || cmd.startsWith('/help ')) {
    const helpArg = msg.text.trim().slice('/help'.length).trim() || undefined;
    await channel.send(senderId, getHelp(helpArg));
    return;
  }

  // "#api " prefix — route through Anthropic API, report cost
  if (msg.text.trim().startsWith('#api ')) {
    const apiMessage = msg.text.trim().slice(5);
    if (!apiMessage) {
      await channel.send(senderId, 'Usage: #api <message>');
      return;
    }
    let replied = false;
    try {
      const result = await runAgentTurn(senderId, apiMessage, config, client);
      for (const chunk of result.chunks) {
        await channel.send(senderId, chunk);
        replied = true;
      }
      const cost = result.inputTokens * INPUT_COST_PER_TOKEN + result.outputTokens * OUTPUT_COST_PER_TOKEN;
      await channel.send(senderId, `Cost: $${cost.toFixed(4)} (${result.inputTokens} in / ${result.outputTokens} out)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[green] api agent error:', message);
      if (!replied) await channel.send(senderId, `API error: ${message}`);
    }
    return;
  }

  // Default — route through Claude Code subprocess (Pro quota, no API cost)
  try {
    const chunks = await runSubprocessAgentTurn(senderId, msg.text, config);
    for (const chunk of chunks) {
      await channel.send(senderId, chunk);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[green] subprocess agent error:', message);
    await channel.send(senderId, `Something went wrong: ${message}`);
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
