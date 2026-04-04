import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, getProject, chunkText } from './config.js';

// ---------------------------------------------------------------------------
// chunkText
// ---------------------------------------------------------------------------

describe('chunkText', () => {
  it('returns single-element array when text fits in one chunk', () => {
    expect(chunkText('hello world', 100)).toEqual(['hello world']);
  });

  it('returns single-element array when text length exactly equals chunkSize', () => {
    const text = 'a'.repeat(50);
    expect(chunkText(text, 50)).toEqual([text]);
  });

  it('splits text that exceeds chunk size', () => {
    const text = 'a'.repeat(200);
    const chunks = chunkText(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(text);
  });

  it('prefers breaking at a newline near the chunk boundary', () => {
    // 60 chars before newline, then more content — chunk size 100
    const line1 = 'a'.repeat(60);
    const line2 = 'b'.repeat(60);
    const text = line1 + '\n' + line2;
    const chunks = chunkText(text, 100);
    // Should break after line1's newline rather than mid-word
    expect(chunks[0]).toBe(line1);
    expect(chunks[1]).toBe(line2);
  });

  it('filters out empty chunks produced during multi-chunk splitting', () => {
    // Build a string longer than chunkSize so it enters the splitting loop.
    // The newlines sit right at the boundary, which can produce empty slices
    // after trimming — those are filtered out.
    const text = 'a'.repeat(60) + '\n\n' + 'b'.repeat(60);
    const chunks = chunkText(text, 60);
    expect(chunks.every(c => c.length > 0)).toBe(true);
  });

  it('returns single-element array for empty string (fits in chunk)', () => {
    // Empty string satisfies text.length <= chunkSize, so it is returned as-is.
    expect(chunkText('', 100)).toEqual(['']);
  });
});

// ---------------------------------------------------------------------------
// getProject
// ---------------------------------------------------------------------------

describe('getProject', () => {
  const config = {
    green: { name: 'junior' },
    signal: { daemon: '127.0.0.1:7583', approved_numbers: [] },
    openclaw: { gateway: '', workspace: '' },
    imessage: { approved_numbers: [] },
    claude_code: {
      binary: 'claude',
      timeout_ms: 30000,
      chunk_size: 3800,
      default_project: 'alpha',
      skip_permissions: false,
    },
    inference: { model: 'claude-sonnet-4-6', max_tokens: 8192 },
    chew: { url: 'http://localhost:8983' },
    projects: [
      { name: 'alpha', path: '/tmp/alpha', description: 'Alpha project' },
      { name: 'Beta', path: '/tmp/beta', description: 'Beta project' },
    ],
  };

  it('finds a project by exact name', () => {
    expect(getProject(config, 'alpha')?.name).toBe('alpha');
  });

  it('is case-insensitive', () => {
    expect(getProject(config, 'ALPHA')?.name).toBe('alpha');
    expect(getProject(config, 'beta')?.name).toBe('Beta');
  });

  it('returns undefined for unknown project', () => {
    expect(getProject(config, 'nonexistent')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

describe('loadConfig', () => {
  let tmpFile: string;

  const minimalYaml = `
green:
  name: tester
signal:
  daemon: "127.0.0.1:7583"
  approved_numbers: []
openclaw:
  gateway: "ws://localhost:9000"
  workspace: "./workspace"
imessage:
  approved_numbers: []
projects:
  - name: myproject
    path: ~/code/myproject
    description: "A test project"
claude_code:
  binary: claude
  timeout_ms: 60000
  chunk_size: 3800
  default_project: myproject
  skip_permissions: false
inference:
  model: claude-sonnet-4-6
  max_tokens: 8192
`;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `green-test-${process.pid}.yml`);
    fs.writeFileSync(tmpFile, minimalYaml, 'utf8');
  });

  afterEach(() => {
    fs.unlinkSync(tmpFile);
  });

  it('loads and parses config from a YAML file', () => {
    const cfg = loadConfig(tmpFile);
    expect(cfg.green.name).toBe('tester');
    expect(cfg.signal.daemon).toBe('127.0.0.1:7583');
    expect(cfg.inference.model).toBe('claude-sonnet-4-6');
  });

  it('expands ~ in project paths', () => {
    const cfg = loadConfig(tmpFile);
    const home = process.env.HOME ?? '~';
    expect(cfg.projects[0].path).toBe(path.join(home, 'code/myproject'));
  });

  it('loads projects array', () => {
    const cfg = loadConfig(tmpFile);
    expect(cfg.projects).toHaveLength(1);
    expect(cfg.projects[0].name).toBe('myproject');
  });
});
