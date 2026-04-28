/**
 * Green dashboard server — serves real conversation history from the log DB.
 * Run: npm run dashboard:web
 * Open: http://localhost:9003
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRecentConversations } from 'log';
import { loadConfig } from './config.js';

// ─── source tree ─────────────────────────────────────────────────────────────
const GREEN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.claude', 'workspace']);
const TEXT_EXTS = new Set(['.ts', '.js', '.mts', '.mjs', '.json', '.md', '.yaml',
  '.yml', '.html', '.css', '.sh', '.toml', '.txt', '.env', '.example', '.sql']);
const BINARY_EXTS = new Set(['.db', '.db-shm', '.db-wal', '.png', '.jpg', '.jpeg',
  '.gif', '.ico', '.woff', '.woff2', '.ttf', '.pdf', '.zip', '.gz', '.tar']);
const MAX_DEPTH = 5;

interface TreeNode {
  name: string; type: 'file' | 'directory';
  extension?: string; lines?: number; size?: number;
  children?: TreeNode[]; file_count?: number; total_lines?: number;
}

function countLines(p: string): number {
  try { return fs.readFileSync(p, 'utf8').split('\n').length; } catch { return 0; }
}

function buildTree(dir: string, depth = 0): TreeNode[] {
  if (depth > MAX_DEPTH) return [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const items: TreeNode[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.env.example') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      const children = buildTree(full, depth + 1);
      const total_lines = children.reduce((s, c) => s + (c.lines || 0) + (c.total_lines || 0), 0);
      const file_count  = children.reduce((s, c) => s + (c.type === 'file' ? 1 : (c.file_count || 0)), 0);
      items.push({ name: e.name, type: 'directory', children, file_count, total_lines });
    } else if (e.isFile()) {
      const ext = path.extname(e.name);
      if (BINARY_EXTS.has(ext)) continue;
      let size = 0; try { size = fs.statSync(full).size; } catch {}
      const lines = TEXT_EXTS.has(ext) ? countLines(full) : 0;
      items.push({ name: e.name, type: 'file', extension: ext.slice(1) || 'txt', lines, size });
    }
  }
  return items;
}

function gatherStats(tree: TreeNode[]) {
  let files = 0, directories = 0, total_lines = 0, total_size = 0;
  function walk(nodes: TreeNode[]) {
    for (const n of nodes) {
      if (n.type === 'file') { files++; total_lines += n.lines || 0; total_size += n.size || 0; }
      else { directories++; walk(n.children || []); }
    }
  }
  walk(tree);
  return { files, directories, total_lines, total_size };
}

function sourceTreeHandler(res: http.ServerResponse) {
  try {
    const tree = buildTree(GREEN_ROOT);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ stats: gatherStats(tree), tree }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
}

const PORT = 9003;
const config = loadConfig();

function parseCommand(request: string): string {
  const t = request.trim();
  if (t.startsWith('#api ')) return '#api';
  if (t.startsWith('/')) return t.split(/\s/)[0].toLowerCase();
  return 'message';
}

function apiHandler(res: http.ServerResponse) {
  try {
    const rows = getRecentConversations(500);
    const data = {
      maxTokens: config.inference.max_tokens,
      conversations: rows.map(r => ({
        id: r.id,
        senderId: r.senderId,
        cmd: parseCommand(r.request),
        request: r.request,
        response: r.response,
        trace: r.trace,
        createdAt: r.createdAt,
      })),
    };
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
}

const HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Green — Dashboard</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
:root {
  --bg0:#070b09; --bg1:#0a0f0c; --bg2:#0f1612; --bg3:#141d18;
  --line:#1f3028; --line2:#28402f;
  --ink1:#e8f5ec; --ink2:#b6c9bd; --ink3:#7a8e82; --ink4:#4a5e54;
  --g3:#2d6a4a; --g4:#3fb87a; --g5:#7ee8b0; --g6:#c8ffdd;
  --amber:#f0b341; --red:#ff6b5b;
  --ch-code:#7ee8b0; --ch-api:#f0b341; --ch-local:#7a8e82;
  --mono:"JetBrains Mono",ui-monospace,monospace;
  --sans:"Inter",-apple-system,sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:var(--bg0);color:var(--ink1);font-family:var(--sans);font-size:14px}

#app{display:grid;grid-template-rows:48px 1fr;height:100vh}
#topbar{background:var(--bg1);border-bottom:1px solid var(--line);
  display:flex;align-items:center;gap:16px;padding:0 20px}
#topbar .logo{font-family:var(--mono);font-weight:700;letter-spacing:.06em;color:var(--g6);
  display:flex;align-items:center;gap:8px}
#topbar .logo::before{content:"";display:inline-block;width:10px;height:10px;
  border-radius:2px;background:var(--g4);box-shadow:0 0 10px var(--g4)}
#topbar .stats{font-family:var(--mono);font-size:11px;color:var(--ink3);margin-left:auto;margin-right:0}
#topbar .stat{margin-left:16px}
#topbar .stat span{color:var(--g5)}

#body{display:grid;grid-template-columns:320px 1fr 300px;overflow:hidden}

/* ── list panel ── */
#list-panel{border-right:1px solid var(--line);display:flex;flex-direction:column;min-height:0}
#list-header{padding:10px 14px;border-bottom:1px solid var(--line);
  display:flex;align-items:center;gap:8px;flex-shrink:0}
#list-header label{font-family:var(--mono);font-size:11px;color:var(--ink3);
  letter-spacing:.1em;text-transform:uppercase}
#filter{background:var(--bg2);border:1px solid var(--line);color:var(--ink1);
  border-radius:3px;padding:4px 9px;font-family:var(--mono);font-size:12px;
  outline:none;flex:1}
#filter:focus{border-color:var(--g3)}
#list{flex:1;overflow-y:auto;padding:8px 0}
#list::-webkit-scrollbar{width:6px}
#list::-webkit-scrollbar-thumb{background:var(--line);border-radius:3px}
.row{padding:10px 14px;cursor:pointer;border-left:2px solid transparent;transition:background .1s}
.row:hover{background:var(--bg2)}
.row.active{background:var(--bg3);border-left-color:var(--g4)}
.row .cmd{font-family:var(--mono);font-size:12px;font-weight:600;color:var(--g5)}
.row .cmd.api{color:var(--amber)}
.row .cmd.msg{color:var(--ink3)}
.row .preview{font-size:12px;color:var(--ink3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px}
.row .meta{font-family:var(--mono);font-size:10px;color:var(--ink4);margin-top:4px}

/* ── detail panel (center) ── */
#detail-panel{display:flex;flex-direction:column;min-height:0;background:var(--bg0)}
#detail-header{padding:10px 20px;border-bottom:1px solid var(--line);
  display:flex;align-items:center;gap:10px;flex-shrink:0;background:var(--bg1)}
#detail-header .cmd-label{font-family:var(--mono);font-size:12px;color:var(--g5);font-weight:600}
#detail-header .ts{font-family:var(--mono);font-size:11px;color:var(--ink3);margin-left:auto}
#detail-body{flex:1;overflow-y:auto;padding:20px 24px;display:flex;flex-direction:column;gap:20px}
#detail-body::-webkit-scrollbar{width:6px}
#detail-body::-webkit-scrollbar-thumb{background:var(--line);border-radius:3px}
.block{display:flex;flex-direction:column;gap:6px}
.block-label{font-family:var(--mono);font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:var(--ink4)}
.block-content{font-family:var(--mono);font-size:13px;line-height:1.6;color:var(--ink2);
  background:var(--bg2);border:1px solid var(--line);border-radius:4px;
  padding:12px 14px;white-space:pre-wrap;word-break:break-word}
.block-content.request{color:var(--g6);background:rgba(45,106,74,.1);border-color:var(--g3)}
.empty{display:flex;align-items:center;justify-content:center;height:100%;
  font-family:var(--mono);font-size:13px;color:var(--ink4);flex-direction:column;gap:8px}
.empty .hint{font-size:11px}
mark.hl{background:rgba(240,179,65,.25);color:var(--g6);border-radius:2px;padding:0 1px}

/* ── trace panel (right rail) — two flex sub-sections ── */
#trace-panel{border-left:1px solid var(--line);background:var(--bg1);
  display:flex;flex-direction:column;min-height:0;overflow:hidden}
/* shared header style for both sub-sections */
.rp-header{padding:10px 16px;border-bottom:1px solid var(--line);flex-shrink:0;
  display:flex;align-items:center;gap:8px}
.rp-header span{font-family:var(--mono);font-size:11px;color:var(--ink3);
  letter-spacing:.1em;text-transform:uppercase}
/* trace sub-section (top, 55%) */
#trace-section{flex:1 1 55%;min-height:80px;display:flex;flex-direction:column;overflow:hidden}
#trace-body{flex:1;overflow-y:auto;padding:12px 0}
#trace-body::-webkit-scrollbar{width:6px}
#trace-body::-webkit-scrollbar-thumb{background:var(--line);border-radius:3px}
/* health sub-section (bottom, 45%) */
#health-section{flex:1 1 45%;min-height:80px;display:flex;flex-direction:column;
  overflow:hidden;border-top:1px solid var(--line)}
#health-body{flex:1;overflow-y:auto;padding:4px 0}
#health-body::-webkit-scrollbar{width:6px}
#health-body::-webkit-scrollbar-thumb{background:var(--line);border-radius:3px}

.trace-empty{padding:20px 16px;font-family:var(--mono);font-size:11px;color:var(--ink4)}

/* service health rows */
.health-row{display:grid;grid-template-columns:10px 1fr 36px 48px;align-items:center;
  gap:8px;padding:5px 16px;border-bottom:1px solid rgba(255,255,255,.02)}
.health-dot{width:6px;height:6px;border-radius:1px;flex-shrink:0}
.health-svc-name{font-family:var(--mono);font-size:11.5px;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.health-svc-sub{font-family:var(--mono);font-size:9.5px;color:var(--ink4);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.health-calls{font-family:var(--mono);font-size:11px;color:var(--ink3);text-align:right}
.health-ms{font-family:var(--mono);font-size:10px;color:var(--ink4);text-align:right}
.health-empty{padding:16px;font-family:var(--mono);font-size:11px;color:var(--ink4)}

.trace-stats{display:grid;grid-template-columns:1fr 1fr;gap:1px;
  background:var(--line);border-bottom:1px solid var(--line);margin-bottom:8px}
.trace-stat{background:var(--bg1);padding:10px 16px}
.trace-stat-label{font-family:var(--mono);font-size:10px;color:var(--ink4);
  letter-spacing:.12em;text-transform:uppercase;margin-bottom:4px}
.trace-stat-value{font-family:var(--mono);font-size:17px;font-weight:600}
.trace-stat-value.green{color:var(--g5)}
.trace-stat-value.amber{color:var(--amber)}
.trace-stat-value.gray{color:var(--ink3)}
.trace-stat-value.red{color:var(--red)}

.channel-badge{display:inline-flex;align-items:center;gap:5px;
  font-family:var(--mono);font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid}
.channel-badge.claude-code{color:var(--ch-code);border-color:var(--g3);background:rgba(63,184,122,.08)}
.channel-badge.api{color:var(--ch-api);border-color:#6b4f1a;background:rgba(240,179,65,.08)}
.channel-badge.local{color:var(--ch-local);border-color:var(--line);background:transparent}

.trace-steps-header{padding:8px 16px 4px;font-family:var(--mono);font-size:10px;
  color:var(--ink4);letter-spacing:.12em;text-transform:uppercase}
.trace-step{padding:8px 16px;border-bottom:1px solid rgba(255,255,255,.025)}
.trace-step-top{display:flex;align-items:center;gap:8px;margin-bottom:5px}
.trace-step-svc{font-family:var(--mono);font-size:11.5px;font-weight:600;color:var(--ink1)}
.trace-step-ms{font-family:var(--mono);font-size:10px;color:var(--ink4);margin-left:auto;white-space:nowrap}
.trace-step-desc{font-family:var(--mono);font-size:11px;color:var(--ink3);margin-bottom:5px}
.trace-bar-track{height:3px;background:var(--bg3);border-radius:2px;overflow:hidden}
.trace-bar-fill{height:100%;border-radius:2px;transition:width .3s}

/* ── settings ── */
#settings-wrap{position:relative;margin-left:auto}
#settings-btn{all:unset;cursor:pointer;display:flex;align-items:center;gap:5px;
  padding:5px 10px;border-radius:4px;font-family:var(--mono);font-size:11px;
  color:var(--ink3);border:1px solid transparent;transition:all .15s}
#settings-btn:hover{color:var(--ink1);border-color:var(--line);background:var(--bg2)}
#settings-btn.open{color:var(--g5);border-color:var(--g3);background:rgba(63,184,122,.08)}
#settings-panel{display:none;position:absolute;right:0;top:calc(100% + 8px);
  width:360px;max-height:calc(100vh - 80px);background:var(--bg2);
  border:1px solid var(--line2);border-radius:6px;
  box-shadow:0 8px 32px rgba(0,0,0,.5);z-index:100;overflow-y:auto;overflow-x:hidden}
#settings-panel.open{display:flex;flex-direction:column}
#settings-panel::-webkit-scrollbar{width:6px}
#settings-panel::-webkit-scrollbar-thumb{background:var(--line);border-radius:3px}
/* collapsible sections */
.sp-section{border-bottom:1px solid var(--line)}
.sp-section:last-child{border-bottom:none}
.sp-section-hdr{all:unset;box-sizing:border-box;width:100%;cursor:pointer;
  display:flex;align-items:center;justify-content:space-between;
  padding:11px 16px;font-family:var(--mono);font-size:11px;font-weight:600;
  color:var(--ink2);letter-spacing:.04em;transition:background .1s}
.sp-section-hdr:hover{background:rgba(255,255,255,.025)}
.sp-chevron{transition:transform .2s;flex-shrink:0;color:var(--ink4)}
.sp-section-hdr.open .sp-chevron{transform:rotate(90deg)}
.sp-section-body{overflow:hidden}
/* rows inside sections */
.sp-section-label{padding:8px 16px 3px;font-family:var(--mono);font-size:10px;
  color:var(--ink4);letter-spacing:.1em;text-transform:uppercase}
.sp-row{display:flex;align-items:center;justify-content:space-between;
  padding:8px 16px;gap:12px}
.sp-row+.sp-row{border-top:1px solid var(--line)}
.sp-row-info{display:flex;flex-direction:column;gap:2px;min-width:0}
.sp-label{font-family:var(--mono);font-size:12px;color:var(--ink2)}
.sp-sub{font-family:var(--mono);font-size:10px;color:var(--ink4)}
/* toggle switch */
.tog{position:relative;width:36px;height:20px;flex-shrink:0;cursor:pointer}
.tog input{position:absolute;opacity:0;width:0;height:0}
.tog-track{position:absolute;inset:0;border-radius:10px;background:var(--bg3);
  border:1px solid var(--line2);transition:background .2s,border-color .2s}
.tog-thumb{position:absolute;top:3px;left:3px;width:12px;height:12px;
  border-radius:50%;background:var(--ink4);transition:transform .2s,background .2s}
.tog input:checked ~ .tog-track{background:rgba(63,184,122,.25);border-color:var(--g4)}
.tog input:checked ~ .tog-track .tog-thumb{transform:translateX(16px);background:var(--g5)}
/* source code tree */
.src-stats{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line);
  border-bottom:1px solid var(--line)}
.src-stat{background:var(--bg2);padding:8px 14px}
.src-stat-val{font-family:var(--mono);font-size:15px;font-weight:600;color:var(--g5)}
.src-stat-lbl{font-family:var(--mono);font-size:9.5px;color:var(--ink4);
  letter-spacing:.1em;text-transform:uppercase;margin-top:2px}
.src-tree{padding:4px 0;font-family:var(--mono);font-size:11.5px}
.src-tree-row{display:flex;align-items:center;gap:4px;padding:2px 12px;
  cursor:pointer;color:var(--ink2);line-height:1.5;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.src-tree-row:hover{background:rgba(255,255,255,.03)}
.src-dir-toggle{width:14px;flex-shrink:0;color:var(--ink4);font-size:9px;text-align:center}
.src-dir-name{color:var(--ink1);font-weight:600}
.src-file-name{color:var(--ink2)}
.src-meta{color:var(--ink4);font-size:10px;margin-left:auto;padding-left:8px;flex-shrink:0}
.src-children{overflow:hidden}
.src-loading{padding:12px 16px;font-family:var(--mono);font-size:11px;color:var(--ink3)}
</style>
</head>
<body>
<div id="app">
  <div id="topbar">
    <div class="logo">GREEN</div>
    <span style="font-family:var(--mono);font-size:11px;color:var(--ink3)">signal command history</span>
    <div class="stats" id="stats"></div>
    <div id="settings-wrap">
      <button id="settings-btn" title="Dashboard settings">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
          <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
        </svg>
        Settings
      </button>
      <div id="settings-panel">
        <!-- ── Dashboard Settings (collapsed by default) ── -->
        <div class="sp-section">
          <button class="sp-section-hdr" data-sp-target="sp-dashboard">
            Dashboard Settings
            <svg class="sp-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 2l4 4-4 4"/></svg>
          </button>
          <div class="sp-section-body" id="sp-dashboard" style="display:none">
            <div class="sp-section-label">Filter Highlights</div>
            <div class="sp-row">
              <div class="sp-row-info">
                <span class="sp-label">List panel</span>
                <span class="sp-sub">Highlight matches in command &amp; preview</span>
              </div>
              <label class="tog"><input type="checkbox" id="setting-list-hl"/><span class="tog-track"><span class="tog-thumb"></span></span></label>
            </div>
            <div class="sp-row">
              <div class="sp-row-info">
                <span class="sp-label">Detail panel</span>
                <span class="sp-sub">Highlight matches in request &amp; response</span>
              </div>
              <label class="tog"><input type="checkbox" id="setting-detail-hl"/><span class="tog-track"><span class="tog-thumb"></span></span></label>
            </div>
          </div>
        </div>
        <!-- ── Source Code (collapsed by default) ── -->
        <div class="sp-section">
          <button class="sp-section-hdr" data-sp-target="sp-source">
            Source Code
            <svg class="sp-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 2l4 4-4 4"/></svg>
          </button>
          <div class="sp-section-body" id="sp-source" style="display:none">
            <div id="sp-source-content"><div class="src-loading">Loading…</div></div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div id="body">
    <div id="list-panel">
      <div id="list-header">
        <label>Conversations</label>
        <input id="filter" placeholder="filter…" autocomplete="off"/>
      </div>
      <div id="list"></div>
    </div>
    <div id="detail-panel">
      <div id="detail-header" style="display:none">
        <span class="cmd-label" id="dh-cmd"></span>
        <span id="dh-sender" style="font-family:var(--mono);font-size:11px;color:var(--ink4)"></span>
        <span class="ts" id="dh-ts"></span>
      </div>
      <div id="detail-body">
        <div class="empty">
          <div>Select a conversation</div>
          <div class="hint">j / k to navigate · click to view</div>
        </div>
      </div>
    </div>
    <div id="trace-panel">
      <div id="trace-section">
        <div class="rp-header">
          <span>Processing Trace</span>
        </div>
        <div id="trace-body">
          <div class="trace-empty">Select a conversation to see its trace.</div>
        </div>
      </div>
      <div id="health-section">
        <div class="rp-header">
          <span>Service Health</span>
        </div>
        <div id="health-body">
          <div class="health-empty">No service data yet.</div>
        </div>
      </div>
    </div>
  </div>
</div>
<script>
let data = [];
let maxTokens = 8192;
let selected = null;
let filterText = '';

function fmtTs(ms) {
  const d = new Date(ms);
  return d.toLocaleString('en-US', {month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true});
}

function cmdClass(cmd) {
  if (cmd === '#api') return 'api';
  if (cmd === 'message') return 'msg';
  return '';
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Escape rawText then wrap every occurrence of query in <mark class="hl">.
// Matching is done on raw text by index so HTML entity encoding never causes
// a mismatch between the search string and the escaped output.
function highlightText(rawText, query) {
  if (!query) return escHtml(rawText);
  const text = String(rawText);
  const lower = text.toLowerCase();
  const lowerQ = query.toLowerCase();
  const parts = [];
  let i = 0;
  while (i < text.length) {
    const idx = lower.indexOf(lowerQ, i);
    if (idx === -1) { parts.push(escHtml(text.slice(i))); break; }
    parts.push(escHtml(text.slice(i, idx)));
    parts.push('<mark class="hl">' + escHtml(text.slice(idx, idx + lowerQ.length)) + '</mark>');
    i = idx + lowerQ.length;
  }
  return parts.join('');
}

function renderTrace(r) {
  const body = document.getElementById('trace-body');
  if (!r || !r.trace) {
    body.innerHTML = '<div class="trace-empty">'
      + (r ? 'No trace — this conversation was recorded before tracing was added.' : 'Select a conversation to see its trace.')
      + '</div>';
    return;
  }

  const t = r.trace;
  const ch = t.channel;
  const chLabel = ch === 'claude-code' ? 'Claude Code Pro' : ch === 'api' ? 'API' : 'Local';
  const chClass = ch;
  const multiStep = t.steps.length > 1;

  function fmtMs(ms) {
    return ms >= 1000 ? (ms / 1000).toFixed(2) + 's' : ms + 'ms';
  }

  // ── stats grid ──
  // Always: channel, latency
  // API only: input tokens, output tokens, output % of max, cost
  let statsHtml = '<div class="trace-stats">'
    + '<div class="trace-stat" style="grid-column:1/-1">'
    +   '<div class="trace-stat-label">Channel</div>'
    +   '<div class="trace-stat-value ' + (ch === 'api' ? 'amber' : ch === 'local' ? 'gray' : 'green') + '" style="font-size:13px;margin-top:2px">'
    +     '<span class="channel-badge ' + chClass + '">' + escHtml(chLabel) + (t.project ? ' · ' + escHtml(t.project) : '') + '</span>'
    +   '</div>'
    + '</div>'
    + '<div class="trace-stat">'
    +   '<div class="trace-stat-label">Latency</div>'
    +   '<div class="trace-stat-value green">' + escHtml(fmtMs(t.latencyMs)) + '</div>'
    + '</div>';

  if (t.inputTokens != null) {
    statsHtml += '<div class="trace-stat">'
      + '<div class="trace-stat-label">Input tokens</div>'
      + '<div class="trace-stat-value amber">' + t.inputTokens.toLocaleString() + '</div>'
      + '</div>';
  }
  if (t.outputTokens != null) {
    const outPct = Math.round(t.outputTokens / maxTokens * 100);
    statsHtml += '<div class="trace-stat">'
      + '<div class="trace-stat-label">Output tokens</div>'
      + '<div class="trace-stat-value amber">' + t.outputTokens.toLocaleString() + '</div>'
      + '</div>'
      + '<div class="trace-stat">'
      + '<div class="trace-stat-label">% of ' + maxTokens.toLocaleString() + ' max</div>'
      + '<div class="trace-stat-value ' + (outPct >= 80 ? 'red' : outPct >= 50 ? 'amber' : 'green') + '">' + outPct + '%</div>'
      + '</div>';
  }
  if (t.cost != null && t.cost > 0) {
    statsHtml += '<div class="trace-stat">'
      + '<div class="trace-stat-label">Cost</div>'
      + '<div class="trace-stat-value amber">$' + t.cost.toFixed(4) + '</div>'
      + '</div>';
  }
  statsHtml += '</div>';

  // ── steps ──
  // Only show per-step ms when there are multiple steps; for a single step
  // the latency is already shown in the stats grid above.
  const totalMs = t.steps.reduce((s, x) => s + x.ms, 0) || 1;
  const barColor = ch === 'api' ? 'var(--amber)' : ch === 'local' ? 'var(--ink3)' : 'var(--g4)';

  let stepsHtml = '<div class="trace-steps-header">Steps</div>';
  t.steps.forEach((step) => {
    const pct = Math.max(4, Math.round(step.ms / totalMs * 100));
    stepsHtml += '<div class="trace-step">'
      + '<div class="trace-step-top">'
      +   '<span class="trace-step-svc">' + escHtml(step.svc) + '</span>'
      +   (multiStep ? '<span class="trace-step-ms">' + escHtml(fmtMs(step.ms)) + '</span>' : '')
      + '</div>'
      + '<div class="trace-step-desc">' + escHtml(step.step) + '</div>'
      + '<div class="trace-bar-track"><div class="trace-bar-fill" style="width:' + pct + '%;background:' + barColor + '"></div></div>'
      + '</div>';
  });

  body.innerHTML = statsHtml + stepsHtml;
}

function renderDetail(r) {
  if (!r) {
    document.getElementById('detail-header').style.display = 'none';
    document.getElementById('detail-body').innerHTML =
      '<div class="empty"><div>Select a conversation</div><div class="hint">j / k to navigate · click to view</div></div>';
    renderTrace(null);
    return;
  }
  document.getElementById('detail-header').style.display = 'flex';
  document.getElementById('dh-cmd').textContent = r.cmd;
  document.getElementById('dh-cmd').className = 'cmd-label ' + cmdClass(r.cmd);
  document.getElementById('dh-sender').textContent = r.senderId;
  document.getElementById('dh-ts').textContent = fmtTs(r.createdAt);

  const detailQ = settings.detailHighlights ? filterText : '';
  document.getElementById('detail-body').innerHTML =
    '<div class="block">'
    + '<div class="block-label">Request</div>'
    + '<div class="block-content request">' + highlightText(r.request, detailQ) + '</div>'
    + '</div>'
    + '<div class="block">'
    + '<div class="block-label">Response</div>'
    + '<div class="block-content">' + highlightText(r.response, detailQ) + '</div>'
    + '</div>';

  renderTrace(r);
}

function renderList() {
  const q = filterText.toLowerCase();
  const rows = q
    ? data.filter(r => r.request.toLowerCase().includes(q) || r.response.toLowerCase().includes(q) || r.cmd.includes(q))
    : data;

  const list = document.getElementById('list');
  if (rows.length === 0) {
    list.innerHTML = '<div style="padding:16px;font-family:var(--mono);font-size:12px;color:var(--ink3)">No conversations yet.</div>';
    return;
  }

  const listQ = settings.listHighlights ? filterText : '';
  list.innerHTML = rows.map(r => {
    const preview = r.response.split('\n')[0].slice(0, 80);
    const cls = cmdClass(r.cmd);
    const latBadge = r.trace ? ' <span style="font-family:var(--mono);font-size:10px;color:var(--ink4)">'
      + (r.trace.latencyMs >= 1000 ? (r.trace.latencyMs/1000).toFixed(1)+'s' : r.trace.latencyMs+'ms') + '</span>' : '';
    return '<div class="row' + (r.id === selected ? ' active' : '') + '" data-id="' + r.id + '">'
      + '<div style="display:flex;align-items:center;gap:6px"><div class="cmd ' + cls + '">' + highlightText(r.cmd, listQ) + '</div>' + latBadge + '</div>'
      + '<div class="preview">' + highlightText(preview, listQ) + '</div>'
      + '<div class="meta">' + escHtml(fmtTs(r.createdAt)) + '</div>'
      + '</div>';
  }).join('');

  list.querySelectorAll('.row').forEach(el => {
    el.addEventListener('click', () => selectId(parseInt(el.dataset.id)));
  });
}

function selectId(id) {
  selected = id;
  const r = data.find(x => x.id === id);
  renderDetail(r);
  renderList();
  const el = document.querySelector('.row.active');
  if (el) el.scrollIntoView({ block: 'nearest' });
}

function renderStats() {
  if (!data.length) { document.getElementById('stats').innerHTML = ''; return; }
  const cmds = {};
  for (const r of data) cmds[r.cmd] = (cmds[r.cmd] || 0) + 1;
  const top = Object.entries(cmds).sort((a,b) => b[1]-a[1]).slice(0,4)
    .map(([k,v]) => '<span class="stat"><span>' + v + '</span> ' + escHtml(k) + '</span>').join('');
  document.getElementById('stats').innerHTML =
    '<span class="stat">total <span>' + data.length + '</span></span>' + top;
}

// ── settings ──────────────────────────────────────────────────────────────────
const SETTINGS_KEY = 'green_dashboard_settings';
const settings = (() => {
  const defaults = { listHighlights: true, detailHighlights: true };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch (_) { return defaults; }
})();

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function syncSettingsUI() {
  document.getElementById('setting-list-hl').checked = settings.listHighlights;
  document.getElementById('setting-detail-hl').checked = settings.detailHighlights;
}

// Panel open / close
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
settingsBtn.addEventListener('click', e => {
  e.stopPropagation();
  const open = settingsPanel.classList.toggle('open');
  settingsBtn.classList.toggle('open', open);
});
document.addEventListener('click', e => {
  if (!document.getElementById('settings-wrap').contains(e.target)) {
    settingsPanel.classList.remove('open');
    settingsBtn.classList.remove('open');
  }
});

// Collapsible sections — each .sp-section-hdr toggles its target body
document.querySelectorAll('.sp-section-hdr').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const targetId = btn.getAttribute('data-sp-target');
    const body = document.getElementById(targetId);
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    btn.classList.toggle('open', !isOpen);
    // Lazy-load source tree on first open
    if (!isOpen && targetId === 'sp-source') loadSourceTree();
  });
});

// Toggle: list highlights
document.getElementById('setting-list-hl').addEventListener('change', e => {
  settings.listHighlights = e.target.checked;
  saveSettings();
  renderList();
});

// Toggle: detail highlights
document.getElementById('setting-detail-hl').addEventListener('change', e => {
  settings.detailHighlights = e.target.checked;
  saveSettings();
  const r = data.find(x => x.id === selected);
  if (r) renderDetail(r);
});

syncSettingsUI();

// ── source tree ───────────────────────────────────────────────────────────────
let sourceTreeLoaded = false;

async function loadSourceTree() {
  if (sourceTreeLoaded) return;
  const container = document.getElementById('sp-source-content');
  try {
    const res = await fetch('/api/source-tree');
    const payload = await res.json();
    if (payload.error) throw new Error(payload.error);
    sourceTreeLoaded = true;
    container.innerHTML = renderSourceTree(payload.stats, payload.tree);
    // Attach expand/collapse listeners
    container.querySelectorAll('[data-src-toggle]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = btn.getAttribute('data-src-node');
        const children = document.getElementById('src-ch-' + id);
        if (!children) return;
        const open = children.style.display !== 'none';
        children.style.display = open ? 'none' : 'block';
        btn.textContent = open ? '▶' : '▼';
      });
    });
  } catch (err) {
    container.innerHTML = '<div class="src-loading" style="color:var(--red)">Failed to load: ' + escHtml(String(err)) + '</div>';
  }
}

function fmtNum(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n); }
function fmtSize(b) {
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1024).toFixed(0) + ' KB';
}

function renderSourceTree(stats, tree) {
  const statsHtml = '<div class="src-stats">'
    + [['Files', fmtNum(stats.files)], ['Dirs', fmtNum(stats.directories)],
       ['Lines', fmtNum(stats.total_lines)], ['Size', fmtSize(stats.total_size)]]
      .map(([lbl, val]) => '<div class="src-stat"><div class="src-stat-val">' + val + '</div><div class="src-stat-lbl">' + lbl + '</div></div>')
      .join('') + '</div>';
  return statsHtml + '<div class="src-tree">' + buildTreeHtml(tree, 0, 'root') + '</div>';
}

const FILE_ICONS = {
  ts:'ts', js:'js', mts:'ts', mjs:'js', json:'{}', md:'md',
  html:'ht', css:'cs', sh:'sh', toml:'tm', yml:'ym', yaml:'ym', txt:'tx', sql:'sq',
};

function buildTreeHtml(nodes, depth, parentId) {
  return nodes.map((node, idx) => {
    const nodeId = parentId + '-' + idx;
    const pad = 'padding-left:' + (12 + depth * 14) + 'px';
    if (node.type === 'directory') {
      const meta = node.total_lines > 0
        ? fmtNum(node.total_lines) + ' lines · ' + node.file_count + ' files'
        : node.file_count + ' files';
      const children = buildTreeHtml(node.children || [], depth + 1, nodeId);
      // Top-level dirs open, deeper collapsed
      const open = depth < 1;
      return '<div>'
        + '<div class="src-tree-row" style="' + pad + '">'
        +   '<span class="src-dir-toggle" data-src-toggle data-src-node="' + nodeId + '">' + (open ? '▼' : '▶') + '</span>'
        +   '<span class="src-dir-name">📁 ' + escHtml(node.name) + '/</span>'
        +   '<span class="src-meta">' + escHtml(meta) + '</span>'
        + '</div>'
        + '<div id="src-ch-' + nodeId + '"' + (open ? '' : ' style="display:none"') + '>' + children + '</div>'
        + '</div>';
    } else {
      const icon = FILE_ICONS[node.extension] || '··';
      const meta = node.lines > 0 ? fmtNum(node.lines) + ' lines' : '';
      return '<div class="src-tree-row" style="' + pad + '">'
        +   '<span class="src-dir-toggle" style="color:var(--ink4);font-size:9px">' + icon + '</span>'
        +   '<span class="src-file-name">' + escHtml(node.name) + '</span>'
        +   (meta ? '<span class="src-meta">' + meta + '</span>' : '')
        + '</div>';
    }
  }).join('');
}

// ── service health ────────────────────────────────────────────────────────────
// Tier and description metadata for known services.
const SVC_META = {
  'Claude Code Pro':       { tier: 'pro',   desc: 'session quota' },
  'Anthropic Messages API':{ tier: 'paid',  desc: '$ / M tokens' },
  'SQLite log.db':         { tier: 'free',  desc: 'local database' },
  'in-process':            { tier: 'free',  desc: 'no API call' },
};
const TIER_DOT = { pro: 'var(--amber)', paid: 'var(--red)', free: 'var(--g4)' };

function renderServiceHealth() {
  // Aggregate every trace step across all stored conversations.
  const tally = {};
  for (const conv of data) {
    if (!conv.trace?.steps) continue;
    for (const step of conv.trace.steps) {
      if (!tally[step.svc]) {
        tally[step.svc] = { svc: step.svc, calls: 0, totalMs: 0, lastSeen: 0, cmds: {} };
      }
      const t = tally[step.svc];
      t.calls++;
      t.totalMs += step.ms;
      t.lastSeen = Math.max(t.lastSeen, conv.createdAt);
      t.cmds[conv.cmd] = (t.cmds[conv.cmd] || 0) + 1;
    }
  }

  const rows = Object.values(tally).sort((a, b) => b.calls - a.calls);
  const body = document.getElementById('health-body');

  if (!rows.length) {
    body.innerHTML = '<div class="health-empty">No service data yet — run a command first.</div>';
    return;
  }

  body.innerHTML = rows.map(r => {
    const meta = SVC_META[r.svc] || { tier: 'free', desc: '' };
    const dot  = '<span class="health-dot" style="background:' + (TIER_DOT[meta.tier] || TIER_DOT.free) + '"></span>';
    const avgMs = r.calls ? Math.round(r.totalMs / r.calls) : 0;
    const cmdList = Object.entries(r.cmds)
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k).slice(0, 4).join(', ');
    const subLine = [meta.desc, cmdList].filter(Boolean).join(' · ');
    return '<div class="health-row">'
      + dot
      + '<div style="min-width:0">'
      +   '<div class="health-svc-name" style="color:' + (r.calls ? 'var(--ink1)' : 'var(--ink4)') + '">' + escHtml(r.svc) + '</div>'
      +   (subLine ? '<div class="health-svc-sub">' + escHtml(subLine) + '</div>' : '')
      + '</div>'
      + '<div class="health-calls">' + r.calls + '</div>'
      + '<div class="health-ms">' + (avgMs ? (avgMs >= 1000 ? (avgMs/1000).toFixed(1)+'s' : avgMs+'ms') : '') + '</div>'
      + '</div>';
  }).join('');
}

async function load() {
  try {
    const res = await fetch('/api/conversations');
    const payload = await res.json();
    const prevLen = data.length;
    maxTokens = payload.maxTokens ?? 8192;
    data = payload.conversations ?? [];
    renderStats();
    renderList();
    renderServiceHealth();
    if (prevLen === 0 && data.length > 0 && !selected) selectId(data[0].id);
    else if (selected) {
      // Re-render trace in case the selected row now has trace data
      const r = data.find(x => x.id === selected);
      if (r) renderTrace(r);
    }
  } catch (e) {
    console.error('fetch failed', e);
  }
}

document.getElementById('filter').addEventListener('input', e => {
  filterText = e.target.value;
  renderList();
  if (settings.detailHighlights && selected) {
    const r = data.find(x => x.id === selected);
    if (r) renderDetail(r);
  }
});

document.addEventListener('keydown', e => {
  if (e.target === document.getElementById('filter')) return;
  const q = filterText.toLowerCase();
  const rows = q ? data.filter(r => r.request.toLowerCase().includes(q) || r.response.toLowerCase().includes(q)) : data;
  const idx = rows.findIndex(r => r.id === selected);
  if (e.key === 'j' || e.key === 'ArrowDown') {
    e.preventDefault();
    if (idx < rows.length - 1) selectId(rows[idx + 1].id);
  } else if (e.key === 'k' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (idx > 0) selectId(rows[idx - 1].id);
  }
});

load();
setInterval(load, 10000);
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/api/conversations') {
    apiHandler(res);
    return;
  }
  if (req.method === 'GET' && req.url === '/api/source-tree') {
    sourceTreeHandler(res);
    return;
  }
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Green dashboard: http://localhost:${PORT}`);
});
