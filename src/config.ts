import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export interface ProjectConfig {
  name: string;
  path: string;
  description: string;
}

export interface Config {
  green: {
    name: string;
  };
  signal: {
    /** TCP address of the signal-cli daemon, e.g. "127.0.0.1:7583" */
    daemon: string;
    approved_numbers: string[];
  };
  openclaw: {
    gateway: string;
    workspace: string;
  };
  imessage: {
    approved_numbers: string[];
  };
  projects: ProjectConfig[];
  claude_code: {
    binary: string;
    timeout_ms: number;
    chunk_size: number;
    default_project: string;
    skip_permissions: boolean;
  };
  inference: {
    model: string;
    max_tokens: number;
  };
  chew: {
    url: string;
  };
}

export function loadConfig(configPath?: string): Config {
  const filePath = configPath ?? process.env.GREEN_CONFIG ?? path.join(process.cwd(), 'config.yml');
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = yaml.load(raw) as Config;

  // Expand ~ in project paths
  for (const project of parsed.projects ?? []) {
    if (project.path.startsWith('~/')) {
      project.path = path.join(process.env.HOME ?? '~', project.path.slice(2));
    }
  }

  return parsed;
}

export function getProject(config: Config, name: string): ProjectConfig | undefined {
  return config.projects.find(p => p.name.toLowerCase() === name.toLowerCase());
}

export function chunkText(text: string, chunkSize: number): string[] {
  if (text.length <= chunkSize) return [text];
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    // Try to break at a newline near the chunk boundary
    let end = Math.min(i + chunkSize, text.length);
    if (end < text.length) {
      const lastNewline = text.lastIndexOf('\n', end);
      if (lastNewline > i + chunkSize * 0.5) end = lastNewline + 1;
    }
    chunks.push(text.slice(i, end).trim());
    i = end;
  }
  return chunks.filter(c => c.length > 0);
}
