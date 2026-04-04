import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { Config } from '../config.js';

const execAsync = promisify(exec);

async function cmd(command: string, cwd?: string): Promise<string> {
  try {
    const { stdout } = await execAsync(command, { cwd, timeout: 10_000 });
    return stdout.trim();
  } catch {
    return '(unavailable)';
  }
}

export async function generateBriefing(config: Config): Promise<string> {
  const lines: string[] = [];
  const now = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  lines.push(`Briefing — ${now}`);
  lines.push('');

  // Run all data fetches in parallel
  const [gitLogs, svcStates, disk, uptime] = await Promise.all([
    Promise.all(config.projects.map(p =>
      cmd('git log --oneline --since="24 hours ago"', p.path).then(log => ({ name: p.name, log }))
    )),
    Promise.all(['green', 'signal-cli'].map(svc =>
      cmd(`systemctl --user is-active ${svc}`).then(state => ({ svc, state }))
    )),
    cmd("df -h / --output=used,avail,pcent | tail -1"),
    cmd('uptime -p'),
  ]);

  for (const { name, log } of gitLogs) {
    lines.push(`${name} commits (24h):`);
    lines.push(log || '  (none)');
    lines.push('');
  }

  lines.push('Services:');
  for (const { svc, state } of svcStates) {
    lines.push(`  ${svc}: ${state === 'active' ? 'up' : 'DOWN'}`);
  }
  lines.push('');

  lines.push(`Disk (/): ${disk}`);
  lines.push(`Uptime: ${uptime}`);

  return lines.join('\n');
}
