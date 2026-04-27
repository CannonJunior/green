/**
 * Green dashboard server — serves real conversation history from the log DB.
 * Run: npm run dashboard:web
 * Open: http://localhost:9003
 */
import http from 'node:http';
import { getRecentConversations } from 'log';

const PORT = 9003;

function parseCommand(request: string): string {
  const t = request.trim();
  if (t.startsWith('#api ')) return '#api';
  if (t.startsWith('/')) return t.split(/\s/)[0].toLowerCase();
  return 'message';
}

function apiHandler(res: http.ServerResponse) {
  try {
    const rows = getRecentConversations(500);
    const data = rows.map(r => ({
      id: r.id,
      senderId: r.senderId,
      cmd: parseCommand(r.request),
      request: r.request,
      response: r.response,
      createdAt: r.createdAt,
    }));
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
  --mono:"JetBrains Mono",ui-monospace,monospace;
  --sans:"Inter",-apple-system,sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:var(--bg0);color:var(--ink1);font-family:var(--sans);font-size:14px}

/* ── layout ── */
#app{display:grid;grid-template-rows:48px 1fr;height:100vh}
#topbar{background:var(--bg1);border-bottom:1px solid var(--line);
  display:flex;align-items:center;gap:16px;padding:0 20px}
#topbar .logo{font-family:var(--mono);font-weight:700;letter-spacing:.06em;color:var(--g6);
  display:flex;align-items:center;gap:8px}
#topbar .logo::before{content:"";display:inline-block;width:10px;height:10px;
  border-radius:2px;background:var(--g4);box-shadow:0 0 10px var(--g4)}
#topbar .stats{font-family:var(--mono);font-size:11px;color:var(--ink3);margin-left:auto}
#topbar .stat{margin-left:16px}
#topbar .stat span{color:var(--g5)}

#body{display:grid;grid-template-columns:340px 1fr;overflow:hidden}

/* ── left: conversation list ── */
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

.row{padding:10px 14px;cursor:pointer;border-left:2px solid transparent;
  transition:background .1s,border-color .1s}
.row:hover{background:var(--bg2)}
.row.active{background:var(--bg3);border-left-color:var(--g4)}
.row .cmd{font-family:var(--mono);font-size:12px;font-weight:600;color:var(--g5)}
.row .cmd.api{color:var(--amber)}
.row .cmd.msg{color:var(--ink3)}
.row .preview{font-size:12px;color:var(--ink3);white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;margin-top:3px}
.row .meta{font-family:var(--mono);font-size:10px;color:var(--ink4);margin-top:4px}

/* ── right: detail ── */
#detail-panel{display:flex;flex-direction:column;min-height:0;background:var(--bg0)}
#detail-header{padding:10px 20px;border-bottom:1px solid var(--line);
  display:flex;align-items:center;gap:10px;flex-shrink:0;background:var(--bg1)}
#detail-header .cmd-label{font-family:var(--mono);font-size:12px;color:var(--g5);font-weight:600}
#detail-header .ts{font-family:var(--mono);font-size:11px;color:var(--ink3);margin-left:auto}
#detail-body{flex:1;overflow-y:auto;padding:20px 28px;display:flex;flex-direction:column;gap:20px}
#detail-body::-webkit-scrollbar{width:6px}
#detail-body::-webkit-scrollbar-thumb{background:var(--line);border-radius:3px}

.block{display:flex;flex-direction:column;gap:6px}
.block-label{font-family:var(--mono);font-size:10px;letter-spacing:.15em;
  text-transform:uppercase;color:var(--ink4)}
.block-content{font-family:var(--mono);font-size:13px;line-height:1.6;
  color:var(--ink2);background:var(--bg2);border:1px solid var(--line);
  border-radius:4px;padding:12px 14px;white-space:pre-wrap;word-break:break-word}
.block-content.request{color:var(--g6);background:rgba(45,106,74,.1);border-color:var(--g3)}

.empty{display:flex;align-items:center;justify-content:center;height:100%;
  font-family:var(--mono);font-size:13px;color:var(--ink4);flex-direction:column;gap:8px}
.empty .hint{font-size:11px}

/* ── no-data state ── */
#no-data{display:none;padding:20px;font-family:var(--mono);font-size:12px;color:var(--ink3)}
</style>
</head>
<body>
<div id="app">
  <div id="topbar">
    <div class="logo">GREEN</div>
    <span style="font-family:var(--mono);font-size:11px;color:var(--ink3)">signal command history</span>
    <div class="stats" id="stats"></div>
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
  </div>
</div>
<script>
let data = [];
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

function renderList() {
  const q = filterText.toLowerCase();
  const rows = q
    ? data.filter(r => r.request.toLowerCase().includes(q) || r.response.toLowerCase().includes(q) || r.cmd.includes(q))
    : data;

  const list = document.getElementById('list');
  if (rows.length === 0) {
    list.innerHTML = '<div id="no-data" style="display:block">No conversations yet.</div>';
    return;
  }

  list.innerHTML = rows.map(r => {
    const preview = r.response.split('\n')[0].slice(0, 80);
    const cls = cmdClass(r.cmd);
    return '<div class="row' + (r.id === selected ? ' active' : '') + '" data-id="' + r.id + '">'
      + '<div class="cmd ' + cls + '">' + escHtml(r.cmd) + '</div>'
      + '<div class="preview">' + escHtml(preview) + '</div>'
      + '<div class="meta">' + escHtml(fmtTs(r.createdAt)) + '</div>'
      + '</div>';
  }).join('');

  list.querySelectorAll('.row').forEach(el => {
    el.addEventListener('click', () => selectId(parseInt(el.dataset.id)));
  });
}

function renderDetail(r) {
  if (!r) {
    document.getElementById('detail-header').style.display = 'none';
    document.getElementById('detail-body').innerHTML =
      '<div class="empty"><div>Select a conversation</div><div class="hint">j / k to navigate · click to view</div></div>';
    return;
  }
  document.getElementById('detail-header').style.display = 'flex';
  document.getElementById('dh-cmd').textContent = r.cmd;
  document.getElementById('dh-cmd').className = 'cmd-label ' + cmdClass(r.cmd);
  document.getElementById('dh-sender').textContent = r.senderId;
  document.getElementById('dh-ts').textContent = fmtTs(r.createdAt);

  document.getElementById('detail-body').innerHTML =
    '<div class="block">'
    + '<div class="block-label">Request</div>'
    + '<div class="block-content request">' + escHtml(r.request) + '</div>'
    + '</div>'
    + '<div class="block">'
    + '<div class="block-label">Response</div>'
    + '<div class="block-content">' + escHtml(r.response) + '</div>'
    + '</div>';
}

function selectId(id) {
  selected = id;
  const r = data.find(x => x.id === id);
  renderDetail(r);
  renderList();
  // Scroll selected row into view
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

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function load() {
  try {
    const res = await fetch('/api/conversations');
    const fresh = await res.json();
    const prevLen = data.length;
    data = fresh;
    renderStats();
    renderList();
    if (prevLen === 0 && data.length > 0 && !selected) {
      selectId(data[0].id);
    }
  } catch (e) {
    console.error('fetch failed', e);
  }
}

document.getElementById('filter').addEventListener('input', e => {
  filterText = e.target.value;
  renderList();
});

// Keyboard nav
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
