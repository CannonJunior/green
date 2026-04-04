import { spawn } from 'node:child_process';
import type { Config, ProjectConfig } from '../config.js';

export interface ClaudeCodeResult {
  success: boolean;
  output: string;
  project: string;
  duration_ms: number;
  exit_code: number | null;
}

/**
 * Execute `claude --print <prompt>` inside a project directory and return the full output.
 * Stderr is folded into the result when the process fails so the agent can report it.
 */
export async function runClaudeCode(
  project: ProjectConfig,
  prompt: string,
  config: Config,
): Promise<ClaudeCodeResult> {
  const start = Date.now();
  const { binary, timeout_ms, skip_permissions } = config.claude_code;

  const args = ['--print', prompt];
  if (skip_permissions) args.push('--dangerously-skip-permissions');

  return new Promise(resolve => {
    const proc = spawn(binary, args, {
      cwd: project.path,
      env: process.env,
      // Do not open a tty — claude must run fully non-interactively
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
    }, timeout_ms);

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timer);
      const output = timedOut
        ? `(timed out after ${timeout_ms / 1000}s)\n${stdout}`.trim()
        : stdout.trim() || stderr.trim();

      resolve({
        success: !timedOut && code === 0,
        output,
        project: project.name,
        duration_ms: Date.now() - start,
        exit_code: code,
      });
    });

    proc.on('error', err => {
      clearTimeout(timer);
      resolve({
        success: false,
        output: `Failed to launch claude: ${err.message}`,
        project: project.name,
        duration_ms: Date.now() - start,
        exit_code: null,
      });
    });
  });
}

/** Summarise a ClaudeCodeResult into a short status prefix for Signal. */
export function formatResult(result: ClaudeCodeResult): string {
  const status = result.success ? 'Done' : 'Error';
  const elapsed = (result.duration_ms / 1000).toFixed(1);
  const header = `[${result.project}] ${status} in ${elapsed}s\n\n`;
  return header + result.output;
}
