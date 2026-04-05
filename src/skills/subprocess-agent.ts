/**
 * Subprocess agent — routes general chat messages through the Claude Code CLI
 * so they consume Pro quota rather than Anthropic API credits.
 *
 * Conversation history is serialised into the prompt on each turn, since the
 * subprocess is stateless. The last MAX_HISTORY_TURNS exchanges are retained
 * to keep prompt size bounded.
 */
import { chunkText } from '../config.js';
import { getProject } from '../config.js';
import { runClaudeCode } from './claude-code.js';
import type { Config } from '../config.js';

const MAX_HISTORY_TURNS = 10;

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

const histories = new Map<string, Turn[]>();

export function clearSubprocessHistory(senderId: string): void {
  histories.delete(senderId);
}

export async function runSubprocessAgentTurn(
  senderId: string,
  userMessage: string,
  config: Config,
): Promise<string[]> {
  const history = histories.get(senderId) ?? [];

  const projectList = config.projects
    .map(p => `  - ${p.name}: ${p.description}`)
    .join('\n');

  const systemContext = [
    `You are Green, a personal AI assistant for ${config.green.name}'s development workflow.`,
    'You receive messages via Signal and help with code projects, research, and general tasks.',
    '',
    'Guidelines:',
    '- Be concise. Signal is not a document editor.',
    '- Plain text only — no markdown, no bullet asterisks. Signal does not render markdown.',
    '- Refer to yourself as Green.',
    `- Today's date: ${new Date().toISOString().split('T')[0]}`,
    '',
    'Available projects:',
    projectList,
  ].join('\n');

  const recentHistory = history.slice(-(MAX_HISTORY_TURNS * 2));
  const historyText = recentHistory.length > 0
    ? '\n\nPrevious conversation:\n' + recentHistory
        .map(t => `${t.role === 'user' ? config.green.name : 'Green'}: ${t.content}`)
        .join('\n')
    : '';

  const prompt = [
    systemContext,
    historyText,
    '',
    `Current message from ${config.green.name}: ${userMessage}`,
    '',
    'Respond as Green. Plain text only, no markdown.',
  ].join('\n');

  const project =
    getProject(config, 'green') ??
    getProject(config, config.claude_code.default_project) ??
    config.projects[0];

  if (!project) {
    return ['No project configured — cannot run subprocess agent.'];
  }

  const result = await runClaudeCode(project, prompt, config);
  const responseText = result.output || '(no response)';

  // Update history
  history.push({ role: 'user', content: userMessage });
  history.push({ role: 'assistant', content: responseText });
  histories.set(senderId, history);

  return chunkText(responseText, config.claude_code.chunk_size);
}
