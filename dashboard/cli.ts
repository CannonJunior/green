#!/usr/bin/env tsx
// Green — terminal dashboard
// Run: tsx dashboard/cli.ts
//
// Layout mirrors the CLI artboard from the design:
//   ┌─ titlebar ──────────────────────────────────────┐
//   │ transcript (j/k to navigate conversations)      │
//   ├─ trace header ──────────────────────────────────┤
//   │ trace for selected response                     │
//   └─ status bar ────────────────────────────────────┘
//
// Keys: j/k nav · ↵ expand · s report · / filter · r reload · q quit

import http from 'node:http';

// ─── colour helpers (standard 16-colour ANSI) ─────────────────────────────────
const RST  = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM  = "\x1b[2m";
const REV  = "\x1b[7m";

const C = {
  dim:   "\x1b[90m",
  green: "\x1b[92m",
  amber: "\x1b[93m",
  red:   "\x1b[91m",
  g4:    "\x1b[32m",
  bgBar: "\x1b[100m",
};

const TIER_C: Record<string, string> = {
  free: "\x1b[32m",
  pro:  "\x1b[33m",
  paid: "\x1b[91m",
};
const TIER_G: Record<string, string> = { free: "·", pro: "+", paid: "$" };

// Known service tiers for trace colouring.
const SVC_TIER: Record<string, string> = {
  'Claude Code Pro':        'pro',
  'Anthropic Messages API': 'paid',
};

// ─── interfaces ───────────────────────────────────────────────────────────────
interface ConvTrace {
  channel: 'claude-code' | 'api' | 'local';
  project?: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
  steps: { svc: string; step: string; ms: number }[];
}

interface Conversation {
  id: number;
  senderId: string;
  cmd: string;
  request: string;
  response: string;
  trace: ConvTrace | null;
  createdAt: number;
}

// ─── terminal helpers ─────────────────────────────────────────────────────────
function altScreen(on: boolean) { return on ? "\x1b[?1049h" : "\x1b[?1049l"; }
function hideCursor(hide: boolean) { return hide ? "\x1b[?25l" : "\x1b[?25h"; }

function fmtTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000)    return "just now";
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + "m ago";
  const d = new Date(ts);
  if (diff < 86_400_000) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function wrapText(text: string, width: number, indent: string): string[] {
  const words = text.split(" ");
  const out: string[] = [];
  let line = indent, lineLen = indent.length;
  for (const w of words) {
    if (lineLen + w.length + 1 > width && lineLen > indent.length) {
      out.push(line.trimEnd());
      line = indent + w + " ";
      lineLen = indent.length + w.length + 1;
    } else {
      line += w + " ";
      lineLen += w.length + 1;
    }
  }
  if (lineLen > indent.length) out.push(line.trimEnd());
  return out;
}

// ─── state ────────────────────────────────────────────────────────────────────
let convs: Conversation[] = [];
let loaded = false;
let selectedIdx = 0;
let filter = "";
let filterMode = false;
let expanded: Record<number, boolean> = {};
let transcriptScroll = 0;
let flash = "";
let flashTimer: ReturnType<typeof setTimeout> | null = null;

function filteredConvs(): Conversation[] {
  if (!filter) return convs;
  const q = filter.toLowerCase();
  return convs.filter(c =>
    c.request.toLowerCase().includes(q) ||
    c.response.toLowerCase().includes(q) ||
    c.cmd.includes(q)
  );
}

// ─── data fetching ────────────────────────────────────────────────────────────
function fetchConvs() {
  http.get('http://localhost:9003/api/conversations', (res) => {
    let body = '';
    res.on('data', (chunk: string) => { body += chunk; });
    res.on('end', () => {
      let needsRender = !loaded;
      try {
        const payload = JSON.parse(body);
        const fresh: Conversation[] = payload.conversations ?? [];
        const changed = fresh.length !== convs.length || fresh[0]?.id !== convs[0]?.id;
        if (changed) {
          convs = fresh;
          selectedIdx = Math.min(selectedIdx, Math.max(0, filteredConvs().length - 1));
          needsRender = true;
        }
        loaded = true;
      } catch {}
      if (needsRender) render();
    });
  }).on('error', () => {
    loaded = true;
    render();
  });
}

// ─── rendering ───────────────────────────────────────────────────────────────
function render() {
  const cols = process.stdout.columns || 120;
  const rows = process.stdout.rows    || 40;

  const visible = filteredConvs();
  const sel     = visible[selectedIdx] ?? null;

  const traceH = sel?.trace?.steps?.length
    ? Math.min(sel.trace.steps.length + 3, Math.floor(rows * 0.38))
    : 4;
  const transH = Math.max(0, rows - 1 - traceH - 1);

  const lines: string[] = [];

  // ── titlebar ──
  const countTag = loaded
    ? `signal · ${convs.length} conv${convs.length === 1 ? '' : 's'}`
    : "signal · loading…";
  // " ● green " (9) + " ~/code/green " (14) = 23 fixed left chars
  const dashes = "─".repeat(Math.max(0, cols - 23 - countTag.length - 2));
  lines.push(`${C.bgBar}${C.green}${BOLD} ● green ${RST}${C.bgBar}${C.dim} ~/code/green ${dashes} ${countTag} ${RST}`);

  // ── transcript ──
  const allRows: string[] = [];
  let selRowIdx = -1;
  let lastDate  = "";

  for (const c of visible) {
    const dateStr = new Date(c.createdAt).toDateString();
    if (dateStr !== lastDate) {
      lastDate = dateStr;
      allRows.push(`${C.dim}─── ${dateStr} ───${RST}`);
    }

    // User message
    allRows.push(`${C.dim}${fmtTime(c.createdAt)} ${RST}${C.green}${BOLD}YOU: ${RST}${truncate(c.request, cols - 24)}`);

    // Green response — record index here for auto-scroll (avoids ▌ string search)
    const isActive = c === sel;
    if (isActive) selRowIdx = allRows.length;

    const latStr = c.trace ? (c.trace.latencyMs / 1000).toFixed(1) + "s" : "";
    const tokTotal = (c.trace?.inputTokens ?? 0) + (c.trace?.outputTokens ?? 0);
    const tokStr  = tokTotal > 0 ? ` · ${(tokTotal / 1000).toFixed(1)}k tok` : "";
    const meta    = `  ${C.dim}[${c.trace?.channel ?? "?"}${latStr ? " · " + latStr : ""}${tokStr}]${RST}`;
    const headline = truncate(c.response.split('\n')[0], cols - 42);

    allRows.push(isActive
      ? `${C.green}▌ ${BOLD}GREEN: ${RST}${REV} ${headline} ${RST}${C.dim}${meta}`
      : `  ${C.green}${BOLD}GREEN: ${RST}${headline}${C.dim}${meta}`
    );

    if (isActive || expanded[c.id]) {
      const respLines = wrapText(c.response, cols - 4, "    ");
      const maxShow   = 14;
      for (const rl of respLines.slice(0, maxShow)) allRows.push(rl);
      if (respLines.length > maxShow) {
        allRows.push(`    ${C.dim}… ${respLines.length - maxShow} more lines (s to print full)${RST}`);
      }
    }
  }

  if (!loaded)             allRows.push(`  ${C.dim}connecting to dashboard server…${RST}`);
  else if (!visible.length) allRows.push(`  ${C.dim}${filter ? "no matches" : "no conversations yet"}${RST}`);

  // Auto-scroll — uses index tracked above, not string search
  if (selRowIdx >= 0) {
    if (selRowIdx < transcriptScroll) transcriptScroll = selRowIdx;
    if (selRowIdx >= transcriptScroll + transH) transcriptScroll = selRowIdx - transH + 1;
  }
  transcriptScroll = Math.max(0, Math.min(transcriptScroll, Math.max(0, allRows.length - transH)));

  for (let i = 0; i < transH; i++) lines.push(allRows[transcriptScroll + i] ?? "");

  // ── trace section ──
  const costStr = sel?.trace?.cost ? `${C.amber}$${sel.trace.cost.toFixed(4)}${RST}` : "free";
  const traceHead = sel
    ? `── trace · ${sel.cmd} · ${sel.trace ? sel.trace.steps.length + " steps · " + (sel.trace.latencyMs / 1000).toFixed(2) + "s · " + costStr : "no trace"}`
    : "── trace";
  lines.push(`${C.bgBar}${C.dim} ${traceHead}${RST}`);

  if (sel?.trace?.steps?.length) {
    const steps = sel.trace.steps;
    const total = steps.reduce((s, x) => s + x.ms, 0) || 1;
    const barW  = Math.max(8, cols - 62);
    for (const [i, step] of steps.slice(0, traceH - 1).entries()) {
      const tier = SVC_TIER[step.svc] ?? "free";
      const tC   = TIER_C[tier];
      const pct  = Math.round(step.ms / total * barW);
      const bar  = "█".repeat(pct) + "░".repeat(Math.max(0, barW - pct));
      const num  = String(i + 1).padStart(2, "0");
      const name = truncate(step.svc, 22).padEnd(22);
      const desc = truncate(step.step, 22).padEnd(22);
      lines.push(`${C.dim}  ${num}  ${RST}${tC}[${TIER_G[tier]}]${RST} ${BOLD}${name}${RST} ${C.dim}${desc}  ${tC}${bar}${RST}${C.dim} ${String(step.ms).padStart(5)}ms${RST}`);
    }
  }

  while (lines.length < rows - 1) lines.push("");

  // ── status bar ──
  let status: string;
  if (filterMode) {
    status = `${C.bgBar}${C.green} / ${RST}${C.bgBar} ${filter}█${RST}`;
  } else {
    const kv = (k: string, v: string) => `${C.bgBar}${C.dim}${k}${RST}${C.bgBar}${v}${RST}`;
    const keys = [kv("j/k","nav"), kv("↵","expand"), kv("s","report"), kv("r","reload"), kv("/","filter"), kv("q","quit")]
      .join(`${C.bgBar}  ${RST}`);
    const filterTag = filter ? `${C.bgBar}${C.amber} [${filter}]${RST}` : "";
    const right = flash
      ? `${C.bgBar}${C.green} ${flash}${RST}`
      : sel ? `${C.bgBar}${C.dim} ${sel.cmd}${RST}` : "";
    status = `${C.bgBar} ${keys}${filterTag}   ${right}${RST}`;
  }
  lines.push(status);

  process.stdout.write("\x1b[2J\x1b[H" + lines.join("\r\n") + hideCursor(true));
}

// ─── input ────────────────────────────────────────────────────────────────────
function setFlash(msg: string) {
  flash = msg;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flash = ""; render(); }, 1600);
}

function printReport(c: Conversation): string {
  const parts: string[] = [
    `\n${C.green}${BOLD}=== ${c.cmd} — ${new Date(c.createdAt).toLocaleString()} ===${RST}\n`,
    c.response,
    "",
    [
      `${C.dim}channel:${RST} ${c.trace?.channel ?? "?"}`,
      c.trace?.latencyMs  ? `${C.dim}latency:${RST} ${(c.trace.latencyMs / 1000).toFixed(2)}s`  : "",
      c.trace?.inputTokens ? `${C.dim}tokens:${RST} ${((c.trace.inputTokens + (c.trace.outputTokens ?? 0))).toLocaleString()}` : "",
      c.trace?.cost        ? `${C.dim}cost:${RST} $${c.trace.cost.toFixed(4)}`                   : "",
    ].filter(Boolean).join("  ") + "\n",
  ];
  return parts.join("\n");
}

// ─── main ─────────────────────────────────────────────────────────────────────
const pendingReports: string[] = [];

function cleanup() {
  try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch (_) {}
  process.stdout.write(altScreen(false) + hideCursor(false));
  if (pendingReports.length) process.stdout.write(pendingReports.join("\n"));
  process.exit(0);
}

process.on("SIGTERM", cleanup);
process.on("SIGINT",  cleanup);
process.on("exit",    () => { try { process.stdout.write(altScreen(false) + hideCursor(false)); } catch (_) {} });
process.on("uncaughtException", cleanup);

process.stdout.write(altScreen(true) + hideCursor(true));
try { if (process.stdin.isTTY) process.stdin.setRawMode(true); } catch (_) {}
process.stdin.resume();
process.stdin.setEncoding("utf8");

render();
fetchConvs();
setInterval(fetchConvs, 10_000);

process.stdout.on("resize", () => render());

process.stdin.on("data", (chunk: string) => {
  if (filterMode) {
    if (chunk === "\r" || chunk === "\n" || chunk === "\x1b") {
      filterMode = false;
    } else if (chunk === "\x7f" || chunk === "\x08") {
      filter = filter.slice(0, -1);
    } else if (chunk.length === 1 && chunk >= " ") {
      filter += chunk;
      selectedIdx = Math.min(selectedIdx, Math.max(0, filteredConvs().length - 1));
    }
    render();
    return;
  }

  const visible = filteredConvs();
  switch (chunk) {
    case "\x03":
    case "q":
      cleanup();
      return;
    case "j":
    case "\x1b[B":
      if (visible.length > 0) selectedIdx = Math.min(visible.length - 1, selectedIdx + 1);
      break;
    case "k":
    case "\x1b[A":
      selectedIdx = Math.max(0, selectedIdx - 1);
      break;
    case "g":
      selectedIdx = 0;
      break;
    case "G":
      selectedIdx = Math.max(0, visible.length - 1);
      break;
    case "\r":
    case "\n": {
      const c = visible[selectedIdx];
      if (c) expanded[c.id] = !expanded[c.id];
      break;
    }
    case "s": {
      const c = visible[selectedIdx];
      if (c) {
        pendingReports.push(printReport(c));
        setFlash(`saved ← ${c.cmd}`);
      }
      break;
    }
    case "r":
      setFlash("reloading…");
      fetchConvs();
      return;
    case "/":
      filterMode = true;
      filter = "";
      break;
    case "\x1b":
      filter = "";
      selectedIdx = Math.min(selectedIdx, Math.max(0, filteredConvs().length - 1));
      break;
  }

  render();
});
