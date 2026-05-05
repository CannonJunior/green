import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { Config } from '../config.js';

const execAsync = promisify(exec);

interface HttpResult {
  name: string;
  url: string;
  up: boolean;
  statusCode?: number;
  ms: number;
}

interface SvcResult {
  name: string;
  active: boolean;
}

async function checkHttp(name: string, url: string): Promise<HttpResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    clearTimeout(timer);
    return { name, url, up: true, statusCode: res.status, ms: Date.now() - start };
  } catch {
    clearTimeout(timer);
    return { name, url, up: false, ms: Date.now() - start };
  }
}

async function checkSystemd(name: string): Promise<SvcResult> {
  try {
    const { stdout } = await execAsync(`systemctl --user is-active ${name}`, { timeout: 5_000 });
    return { name, active: stdout.trim() === 'active' };
  } catch {
    return { name, active: false };
  }
}

export async function generateServiceStatus(config: Config): Promise<string> {
  const httpTargets = [
    { name: 'chew',    url: config.chew?.url ?? 'http://localhost:8983' },
    { name: 'tenx',    url: 'http://localhost:9004' },
    { name: 'log map', url: 'http://localhost:9001' },
    { name: 'mobile',  url: `http://localhost:${config.mobile?.port ?? 9002}` },
  ];

  const systemdTargets = ['green', 'signal-cli'];

  const [httpResults, svcResults] = await Promise.all([
    Promise.all(httpTargets.map(t => checkHttp(t.name, t.url))),
    Promise.all(systemdTargets.map(checkSystemd)),
  ]);

  const now = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const lines: string[] = [`Services — ${now}`, '', 'HTTP'];

  const nameWidth = Math.max(...httpResults.map(r => r.name.length)) + 2;
  const urlWidth  = Math.max(...httpResults.map(r => r.url.length))  + 2;

  for (const r of httpResults) {
    const status = r.up ? `UP ${r.statusCode} (${r.ms}ms)` : 'DOWN';
    lines.push(`  ${r.name.padEnd(nameWidth)}${r.url.padEnd(urlWidth)}${status}`);
  }

  lines.push('', 'System');
  const svcWidth = Math.max(...svcResults.map(r => r.name.length)) + 2;
  for (const r of svcResults) {
    lines.push(`  ${r.name.padEnd(svcWidth)}${r.active ? 'active' : 'INACTIVE'}`);
  }

  return lines.join('\n');
}
