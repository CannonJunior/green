import Anthropic from '@anthropic-ai/sdk';
import type { Config, ProjectConfig } from './config.js';
import { getProject } from './config.js';
import { runClaudeCode, formatResult } from './skills/claude-code.js';
import { fetchUrl } from './skills/web-fetch.js';
import { generateBriefing } from './skills/briefing.js';

// Per-sender conversation history (keyed by phone number or "local")
const histories = new Map<string, Anthropic.MessageParam[]>();

const TOOLS: Anthropic.Messages.ToolUnion[] = [
  {
    type: 'web_search_20250305',
    name: 'web_search',
  },
  {
    name: 'run_claude_code',
    description: [
      'Run a Claude Code prompt against a specific project on this Linux machine.',
      'Use this when the user wants to ask about, investigate, debug, write, or modify code in a project.',
      'The result may be long — summarize the key points in your reply and offer more detail if needed.',
    ].join(' '),
    input_schema: {
      type: 'object',
      properties: {
        project_name: {
          type: 'string',
          description: 'Name of the project to run against. Must match a configured project name.',
        },
        prompt: {
          type: 'string',
          description: 'The full prompt to pass to Claude Code inside that project directory.',
        },
      },
      required: ['project_name', 'prompt'],
    },
  },
  {
    name: 'generate_briefing',
    description: 'Generate a briefing summarising recent git activity across all projects, service health, disk usage, and uptime. Use when the user asks for a status update or daily summary.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'fetch_url',
    description: 'Fetch the contents of a URL and return it as plain text. Use this to read documentation pages, check package versions, or retrieve any public web page.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'list_projects',
    description: 'Return the names and descriptions of all Claude Code projects available on this machine.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

function buildSystemPrompt(config: Config): string {
  const projectList = config.projects
    .map(p => `  - ${p.name}: ${p.description} (${p.path})`)
    .join('\n');

  return [
    `You are Green, a personal AI assistant for ${config.green.name}'s development workflow.`,
    `You receive messages via Signal and can run Claude Code against projects on a Linux machine.`,
    '',
    'Available projects:',
    projectList,
    '',
    'Guidelines:',
    '- Be concise. Signal is not a document editor.',
    '- Plain text only — no markdown, no bullet asterisks. Signal does not render markdown.',
    '- If a task will take time, send a brief "on it" message before starting.',
    '- When Claude Code output is long, summarize the key points and offer to share the full output.',
    '- Refer to yourself as Green.',
    '- If asked to run code in a project not in the list, say so clearly.',
    '',
    `Today's date: ${new Date().toISOString().split('T')[0]}`,
  ].join('\n');
}

async function executeToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  config: Config,
): Promise<string> {
  if (toolName === 'list_projects') {
    return config.projects
      .map(p => `${p.name}: ${p.description}`)
      .join('\n');
  }

  if (toolName === 'generate_briefing') {
    return generateBriefing(config);
  }

  if (toolName === 'fetch_url') {
    return fetchUrl(toolInput['url'] as string);
  }

  if (toolName === 'run_claude_code') {
    const projectName = toolInput['project_name'] as string;
    const prompt = toolInput['prompt'] as string;

    const project: ProjectConfig | undefined = getProject(config, projectName);
    if (!project) {
      const known = config.projects.map(p => p.name).join(', ');
      return `Unknown project "${projectName}". Known projects: ${known}`;
    }

    const result = await runClaudeCode(project, prompt, config);
    return formatResult(result);
  }

  return `Unknown tool: ${toolName}`;
}

/**
 * Run one user turn through the agent loop.
 * Returns an array of strings to send back (split for Signal chunk limits).
 */
export async function runAgentTurn(
  senderId: string,
  userMessage: string,
  config: Config,
  client: Anthropic,
): Promise<string[]> {
  const history = [...(histories.get(senderId) ?? [])];
  history.push({ role: 'user', content: userMessage });

  const systemPrompt = buildSystemPrompt(config);
  let earlyAcknowledgement: string | null = null;

  // Agentic loop: run until the model stops calling tools
  while (true) {
    const response = await client.messages.create({
      model: config.inference.model,
      max_tokens: config.inference.max_tokens,
      system: systemPrompt,
      tools: TOOLS,
      messages: history,
    });

    // Add the assistant turn to history
    history.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      // Final text response
      const textBlock = response.content.find(b => b.type === 'text');
      const replyText = textBlock?.type === 'text' ? textBlock.text : '(no response)';

      histories.set(senderId, history);

      // If we sent an early acknowledgement, prepend nothing — the caller will
      // have already sent it. Just return the final answer.
      return splitForDelivery(replyText, config.claude_code.chunk_size);
    }

    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');

      // If about to call run_claude_code, surface an early acknowledgement on the
      // first tool call so the user isn't left waiting in silence.
      if (!earlyAcknowledgement && toolUseBlocks.some(b => b.name === 'run_claude_code')) {
        earlyAcknowledgement = 'On it — running Claude Code now...';
      }

      // Execute all tool calls (sequential for now — could be parallelised)
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        if (block.type !== 'tool_use') continue;
        const output = await executeToolCall(
          block.name,
          block.input as Record<string, unknown>,
          config,
        );
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: output,
        });
      }

      history.push({ role: 'user', content: toolResults });
      continue;
    }

    // Unexpected stop reason
    histories.set(senderId, history);
    return ['(unexpected stop reason: ' + response.stop_reason + ')'];
  }
}

/** Return the early acknowledgement if set, so the channel can send it immediately. */
export function getEarlyAck(senderId: string, _config: Config): string | null {
  // Not stored — the agent loop emits it inline. This hook exists for channels
  // that want to split the "working..." ping from the final answer.
  void senderId;
  return null;
}

/** Clear conversation history for a sender (e.g. on "/reset" command). */
export function clearHistory(senderId: string): void {
  histories.delete(senderId);
}

function splitForDelivery(text: string, chunkSize: number): string[] {
  if (text.length <= chunkSize) return [text];
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + chunkSize, text.length);
    if (end < text.length) {
      const lastNewline = text.lastIndexOf('\n', end);
      if (lastNewline > i + chunkSize * 0.5) end = lastNewline + 1;
    }
    const chunk = text.slice(i, end).trim();
    if (chunk) chunks.push(chunk);
    i = end;
  }
  return chunks;
}
