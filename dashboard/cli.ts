#!/usr/bin/env tsx
// Green — terminal dashboard
// Run: tsx dashboard/cli.ts
//
// Layout mirrors the CLI artboard from the design:
//   ┌─ titlebar ──────────────────────────────────────┐
//   │ transcript (j/k to navigate Green responses)    │
//   ├─ trace header ──────────────────────────────────┤
//   │ trace for selected response                     │
//   └─ status bar ────────────────────────────────────┘
//
// Keys: j/k nav · ↵ expand · s resend summary to stdout · / filter · q quit

// ─── colour helpers (standard 16-colour ANSI — works in every terminal) ──────
const RST   = "\x1b[0m";
const BOLD  = "\x1b[1m";
const DIM   = "\x1b[2m";
const REV   = "\x1b[7m";   // reverse video — used for selected row highlight

const C = {
  fg:    "\x1b[97m",   // bright white
  dim:   "\x1b[90m",   // dark gray
  green: "\x1b[92m",   // bright green
  amber: "\x1b[93m",   // bright yellow
  red:   "\x1b[91m",   // bright red
  g4:    "\x1b[32m",   // normal green
  bgBar: "\x1b[100m",  // dark-gray background for bars
};

const TIER_C: Record<string, string> = {
  free: "\x1b[32m",   // green
  pro:  "\x1b[33m",   // yellow
  paid: "\x1b[91m",   // bright red
};
const TIER_G: Record<string, string> = { free: "·", pro: "+", paid: "$" };
const RISK_C: Record<string, string> = {
  low:  "\x1b[32m",
  med:  "\x1b[33m",
  high: "\x1b[91m",
};

// ─── data (same content as data.js, typed) ───────────────────────────────────
interface Service {
  id: string; name: string; tier: string;
  cap: string; limit: string; risk: string; proto: string; cost: number;
}
interface TraceStep { svc: string; step: string; t: number; tokens: number; }
interface Block {
  kind: "h2"|"h3"|"p"|"list"|"kv"|"sources";
  text?: string;
  items?: string[] | [string,string][];
}
interface Msg {
  id: string; role: "user"|"green"; ts: number;
  text?: string;
  parent?: string; cmd?: string; channel?: string; title?: string;
  blocks?: Block[]; tokens?: number; cost?: number;
  latencyMs?: number; score?: number; confidence?: number;
  trace?: TraceStep[];
  bug?: { description: string; severity: string };
}

const SERVICES: Service[] = [
  { id:"claude-pro",    name:"Claude Code Pro",       tier:"pro",  cap:"session quota",   limit:"shared with chat",      risk:"med",  proto:"OAuth session",   cost:0 },
  { id:"anthropic-api", name:"Anthropic Messages",    tier:"paid", cap:"$ / M tokens",    limit:"tier-3 rate-limit",     risk:"low",  proto:"Bearer sk-ant-…", cost:3.0 },
  { id:"ollama",        name:"Ollama (local)",        tier:"free", cap:"unlimited",       limit:"8B params, 4k ctx",     risk:"med",  proto:"loopback",        cost:0 },
  { id:"qdrant",        name:"Qdrant (vector)",       tier:"free", cap:"unlimited",       limit:"200 res / call",        risk:"low",  proto:"API key (local)", cost:0 },
  { id:"local-cache",   name:"Local cache",           tier:"free", cap:"unlimited",       limit:"5min TTL",              risk:"low",  proto:"in-process",      cost:0 },
  { id:"signal-cli",    name:"signal-cli",            tier:"free", cap:"unlimited",       limit:"1 device link",         risk:"low",  proto:"linked device",   cost:0 },
  { id:"github-rest",   name:"GitHub REST",           tier:"free", cap:"5,000 / hr",      limit:"PAT scope",             risk:"low",  proto:"PAT",             cost:0 },
  { id:"polygon",       name:"Polygon.io",            tier:"paid", cap:"100 req / min",   limit:"stocks plan",           risk:"low",  proto:"API key",         cost:0.0001 },
  { id:"alpha-vantage", name:"Alpha Vantage",         tier:"free", cap:"5 req / min",     limit:"daily 500",             risk:"med",  proto:"API key",         cost:0 },
  { id:"perplexity",    name:"Perplexity Sonar",      tier:"paid", cap:"$ / call",        limit:"rate-limited",          risk:"low",  proto:"Bearer",          cost:0.005 },
  { id:"yfinance",      name:"yfinance (scrape)",     tier:"free", cap:"best-effort",     limit:"may break unannounced", risk:"high", proto:"HTTP",            cost:0 },
  { id:"sec-edgar",     name:"SEC EDGAR",             tier:"free", cap:"10 req / sec",    limit:"must set User-Agent",   risk:"low",  proto:"HTTP",            cost:0 },
  { id:"openweather",   name:"OpenWeather",           tier:"free", cap:"1,000 / day",     limit:"free tier",             risk:"low",  proto:"API key",         cost:0 },
  { id:"google-places", name:"Google Places",         tier:"paid", cap:"$ / call",        limit:"billing alerts",        risk:"low",  proto:"API key",         cost:0.017 },
  { id:"ticketmaster",  name:"Ticketmaster Discovery",tier:"free", cap:"5,000 / day",     limit:"consumer key",          risk:"low",  proto:"API key",         cost:0 },
  { id:"skyscanner",    name:"Skyscanner",            tier:"paid", cap:"20 req / sec",    limit:"partner agreement",     risk:"med",  proto:"API key",         cost:0.002 },
  { id:"amadeus",       name:"Amadeus Travel",        tier:"paid", cap:"10 req / sec",    limit:"test→prod gate",        risk:"med",  proto:"OAuth2",          cost:0.003 },
  { id:"apple-health",  name:"Apple Health (HK)",     tier:"free", cap:"device-local",    limit:"needs companion app",   risk:"med",  proto:"HealthKit bridge",cost:0 },
  { id:"filesystem",    name:"Local filesystem",      tier:"free", cap:"unlimited",       limit:"—",                     risk:"low",  proto:"fs",              cost:0 },
  { id:"git",           name:"git",                   tier:"free", cap:"unlimited",       limit:"—",                     risk:"low",  proto:"shell",           cost:0 },
];
const SVC = Object.fromEntries(SERVICES.map(s => [s.id, s]));

const TODAY = new Date("2026-04-26T14:28:02");
function t(h: number, m: number, s = 0) {
  const x = new Date(TODAY); x.setHours(h, m, s, 0); return x.getTime();
}

const CONV: Msg[] = [
  { id:"m001", role:"user",  ts:t(7,14),    text:"/morning" },
  { id:"m002", role:"green", ts:t(7,14,11), parent:"m001", cmd:"/morning", channel:"pro",
    title:"Good morning briefing — Apr 26",
    blocks:[
      {kind:"h2",text:"Weather"},
      {kind:"p", text:"Partly cloudy, 64°F → 78°F. 10% rain after 3pm. Wind SW 8mph."},
      {kind:"h2",text:"Health (last 24h)"},
      {kind:"list",items:["Steps: 6,412","Sleep: 7h 22m (REM 1h 41m)","RHR: 58 bpm — normal range"]},
      {kind:"h2",text:"Local"},
      {kind:"p", text:"Farmer's market 9–1 at Riverside. Coffee shop on 5th opens 7:30 today (1h late)."},
    ],
    tokens:2840, cost:0, latencyMs:3210, score:88, confidence:91,
    trace:[
      {svc:"local-cache",  step:"miss",                              t:12,   tokens:0},
      {svc:"apple-health", step:"fetch sleep + activity (last 24h)", t:380,  tokens:0},
      {svc:"openweather",  step:"forecast for 30.27,-97.74",         t:240,  tokens:0},
      {svc:"qdrant",       step:"retrieve user prefs + saved spots", t:95,   tokens:0},
      {svc:"claude-pro",   step:"compose briefing",                  t:2480, tokens:2840},
    ],
  },
  { id:"m003", role:"user",  ts:t(7,21),   text:"/mood 7 ready for the day" },
  { id:"m004", role:"green", ts:t(7,21,1), parent:"m003", cmd:"/mood", channel:"pro",
    blocks:[{kind:"p",text:"Logged mood: 7/10 — \"ready for the day\". 14-day average: 6.4."}],
    tokens:80, cost:0, latencyMs:410, score:100, confidence:100,
    trace:[
      {svc:"filesystem", step:"append ~/.green/mood.jsonl", t:8,   tokens:0},
      {svc:"qdrant",     step:"embed for retrieval",        t:38,  tokens:0},
      {svc:"claude-pro", step:"format ack",                 t:360, tokens:80},
    ],
  },
  { id:"m005", role:"user",  ts:t(11,2),   text:"/best this weekend" },
  { id:"m006", role:"green", ts:t(11,2,9), parent:"m005", cmd:"/best", channel:"pro",
    title:"Best things — weekend of Apr 25–26",
    blocks:[
      {kind:"list",items:[
        "Fri 8pm — Indie film festival opener at the Paramount ($14)",
        "Sat 9–1 — Riverside farmer's market (cash only)",
        "Sat 7pm — Astros vs Rangers @ Globe Life ($28+)",
        "Sun 11am — Wildflower walk at McKinney Falls (free)",
      ]},
    ],
    tokens:1560, cost:0.017, latencyMs:4120, score:82, confidence:78,
    trace:[
      {svc:"local-cache",   step:"miss (last fetch >24h)",          t:10,  tokens:0},
      {svc:"google-places", step:"events near 30.27,-97.74 r=20mi", t:880, tokens:0},
      {svc:"ticketmaster",  step:"events Apr 25–26",                t:620, tokens:0},
      {svc:"qdrant",        step:"filter by user taste vectors",    t:110, tokens:0},
      {svc:"claude-pro",    step:"rank + summarize",                t:2500,tokens:1560},
    ],
  },
  { id:"m007", role:"user",  ts:t(14,28,2), text:"/projects" },
  { id:"m008", role:"green", ts:t(14,28,4), parent:"m007", cmd:"/projects", channel:"pro",
    title:"Available projects",
    blocks:[{kind:"kv",items:[
      ["green","The Green AI assistant itself"],
      ["best","Best things occurring at present location"],
      ["bets","Financial market summaries"],
      ["chew","All things food to chew on"],
      ["warchief","Browser-based 3D game; you are the Warchief"],
      ["decor","Browser application for the home"],
      ["red","Robobrain"],["yellow","Private"],
      ["blue","Framework for iOS app to integrate with Siri / iOS"],
      ["log","Personal log with image and GPS support"],
      ["trip","Round-trip flights, lodging, rental cars between zip codes"],
    ] as [string,string][]}],
    tokens:220, cost:0, latencyMs:240, score:100, confidence:100,
    trace:[
      {svc:"filesystem", step:"scan ~/code/* for .green-project.toml", t:32,  tokens:0},
      {svc:"git",        step:"git -C <each> rev-parse",               t:110, tokens:0},
      {svc:"claude-pro", step:"format list",                           t:98,  tokens:220},
    ],
  },
  { id:"m009", role:"user",  ts:t(14,28,24), text:"/alpha" },
  { id:"m010", role:"green", ts:t(14,28,41), parent:"m009", cmd:"/alpha", channel:"api",
    title:"ALPHA — 2026-04-26 — Earnings today: NE",
    blocks:[
      {kind:"p",  text:"Checking today's earnings…"},
      {kind:"h2", text:"ALPHA — NE (Noble Corporation)"},
      {kind:"p",  text:"Score: 0/85 — MONITOR"},
      {kind:"h3", text:"Signals"},
      {kind:"p",  text:"No significant breakout signals detected."},
      {kind:"h3", text:"Context"},
      {kind:"p",  text:"Q1 2026 results scheduled today after-close, call Apr 27. FY2025: revenue $3.286B (beat); EPS missed, shares −4%. 2026 guidance: $2.8–3.0B revenue. JPMorgan downgraded to Neutral; BTIG raised PT to $42."},
      {kind:"sources",items:[
        "stocktitan.net/news/NE/noble-corporation-plc-to-announce-first-quarter-2026",
        "prnewswire.com/news-releases/noble-corporation-plc-announces-fourth-quarter-and-full-year-2025-results",
        "investing.com/news/company-news/noble-q4-2025-slides-eps-miss-overshadows-revenue-beat",
      ]},
    ],
    tokens:12480, cost:0.0374, latencyMs:16200, score:71, confidence:64,
    trace:[
      {svc:"local-cache",   step:"miss",                          t:12,    tokens:0},
      {svc:"polygon",       step:"today's earnings calendar",     t:320,   tokens:0},
      {svc:"alpha-vantage", step:"NE fundamentals (rev/EPS)",     t:1840,  tokens:0},
      {svc:"sec-edgar",     step:"NE 10-K + 8-K (FY2025)",        t:980,   tokens:0},
      {svc:"perplexity",    step:"analyst notes since Dec 2025",  t:2210,  tokens:0},
      {svc:"yfinance",      step:"price + 60d chart",             t:720,   tokens:0},
      {svc:"qdrant",        step:"user portfolio bias",           t:88,    tokens:0},
      {svc:"anthropic-api", step:"score + write-up",              t:10030, tokens:12480},
    ],
    bug:{description:"Terminal redraw race when long messages overlap.",severity:"minor"},
  },
  { id:"m011", role:"user",  ts:t(15,12),   text:"/trip 78704 to 94110 may 8-12" },
  { id:"m012", role:"green", ts:t(15,12,22),parent:"m011", cmd:"/trip", channel:"api",
    title:"Trip plan — Austin (78704) ↔ San Francisco (94110), May 8–12",
    blocks:[
      {kind:"h3",text:"Flight"},
      {kind:"p", text:"AUS ↔ SFO, United nonstop. Out 8:15a Fri / Back 6:45p Mon. $284 / pax."},
      {kind:"h3",text:"Lodging"},
      {kind:"p", text:"Mission Hotel, 4 nights, $189/nt. 0.6mi from 94110."},
      {kind:"h3",text:"Total"},
      {kind:"p", text:"≈ $1,212 (1 pax). Skip car → use Muni/BART (−$172)."},
    ],
    tokens:4220, cost:0.0127, latencyMs:9800, score:79, confidence:81,
    trace:[
      {svc:"skyscanner",    step:"fares AUS↔SFO May 8–12",   t:1620, tokens:0},
      {svc:"amadeus",       step:"lodging 94110 ±2mi 4-nt",  t:2240, tokens:0},
      {svc:"amadeus",       step:"car rental SFO 4-day",     t:980,  tokens:0},
      {svc:"google-places", step:"neighborhood scoring",     t:410,  tokens:0},
      {svc:"anthropic-api", step:"compose itinerary",        t:4550, tokens:4220},
    ],
  },
  { id:"m013", role:"user",  ts:t(16,4),   text:"/reset" },
  { id:"m014", role:"green", ts:t(16,4,1), parent:"m013", cmd:"/reset", channel:"pro",
    blocks:[{kind:"p",text:"Conversation history cleared. Embeddings retained."}],
    tokens:24, cost:0, latencyMs:80, score:100, confidence:100,
    trace:[
      {svc:"filesystem", step:"rm ~/.green/sessions/<id>.jsonl", t:14, tokens:0},
      {svc:"claude-pro", step:"ack",                             t:66, tokens:24},
    ],
  },
  { id:"m015", role:"user",  ts:t(16,41),   text:"#api compare confidence between yfinance and polygon for NE today" },
  { id:"m016", role:"green", ts:t(16,41,14),parent:"m015", cmd:"#api", channel:"api",
    blocks:[{kind:"p",text:"Polygon last trade $32.41 (T+0.4s). yfinance last trade $32.39 (T+62s, scraped). For intraday triggers prefer Polygon. yfinance has been flaky 2× this week."}],
    tokens:1840, cost:0.0055, latencyMs:4210, score:86, confidence:88,
    trace:[
      {svc:"polygon",       step:"NE last trade",        t:180,  tokens:0},
      {svc:"yfinance",      step:"NE last trade (scrape)",t:1320, tokens:0},
      {svc:"anthropic-api", step:"compare + write up",   t:2710, tokens:1840},
    ],
  },
  { id:"m017", role:"user",  ts:t(17,3),   text:"/clip" },
  { id:"m018", role:"green", ts:t(17,3,7), parent:"m017", cmd:"/clip", channel:"pro",
    blocks:[
      {kind:"p",text:"Clipboard contains a URL → routed to summarize."},
      {kind:"p",text:"\"How small teams ship: 6 patterns from teams under 10 engineers.\" ~7 min read."},
    ],
    tokens:980, cost:0, latencyMs:2840, score:84, confidence:80,
    trace:[
      {svc:"filesystem",  step:"read clipboard via xclip",  t:18,  tokens:0},
      {svc:"local-cache", step:"miss (URL not seen)",       t:8,   tokens:0},
      {svc:"claude-pro",  step:"fetch URL + summarize",     t:2810,tokens:980},
    ],
  },
];

// ─── terminal helpers ─────────────────────────────────────────────────────────
function clr() { return "\x1b[2J\x1b[H"; }
function moveTo(row: number, col: number) { return `\x1b[${row};${col}H`; }
function clearLine() { return "\x1b[2K"; }
function altScreen(on: boolean) { return on ? "\x1b[?1049h" : "\x1b[?1049l"; }
function hideCursor(hide: boolean) { return hide ? "\x1b[?25l" : "\x1b[?25h"; }

function fmtTime(ts: number) {
  const d = new Date(ts);
  const h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
  return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}, ${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function truncate(str: string, max: number) {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
}

function pad(str: string, width: number) {
  const visible = str.replace(/\x1b\[[^m]*m/g, "");
  return str + " ".repeat(Math.max(0, width - visible.length));
}

// ─── state ────────────────────────────────────────────────────────────────────
const greenMsgs = CONV.filter(m => m.role === "green");
let selectedIdx = greenMsgs.findIndex(m => m.id === "m010");
if (selectedIdx < 0) selectedIdx = 0;
let filter = "";
let filterMode = false;
let expanded: Record<string, boolean> = {};
let transcriptScroll = 0;
let flash = "";
let flashTimer: ReturnType<typeof setTimeout> | null = null;

// ─── rendering ───────────────────────────────────────────────────────────────
function render() {
  const cols = process.stdout.columns || 120;
  const rows = process.stdout.rows || 40;

  const filtered = filter
    ? CONV.filter(m => {
        const hay = (m.text || m.title || (m.blocks||[]).map(b => (b as any).text || "").join(" ") || "").toLowerCase();
        return hay.includes(filter.toLowerCase());
      })
    : CONV;

  const selId = greenMsgs[selectedIdx]?.id;
  const selMsg = greenMsgs[selectedIdx];

  // Allocate rows: 1 titlebar, traceH for trace, 1 status; rest = transcript
  const traceH = selMsg?.trace ? Math.min(selMsg.trace.length + 3, Math.floor(rows * 0.38)) : 4;
  const transH = Math.max(0, rows - 1 - traceH - 1);

  const lines: string[] = [];

  // ── titlebar ──
  // Visible fixed: " ● green " (9) + " ~/code/green " (14) + " signal · linked " (17) = 40
  const dashes = "─".repeat(Math.max(0, cols - 40));
  const title = `${C.bgBar}${C.green}${BOLD} ● green ${RST}${C.bgBar}${C.dim} ~/code/green ${RST}${C.bgBar}${C.dim}${dashes} signal · linked${RST}`;
  lines.push(title);

  // ── transcript ──
  // Build all transcript rows first, then window them
  const allRows: string[] = [];
  let lastDate = "";
  for (const m of filtered) {
    const dateStr = new Date(m.ts).toDateString();
    if (dateStr !== lastDate) {
      lastDate = dateStr;
      allRows.push(`${C.dim}─── ${dateStr} ───${RST}`);
    }
    if (m.role === "user") {
      allRows.push(`${C.dim}${fmtTime(m.ts)} ${RST}${C.green}${BOLD}YOU: ${RST}${m.text}`);
    } else {
      const isActive = m.id === selId;
      const cursor = isActive ? `${C.green}▌ ` : `  `;
      const chTag = m.channel === "api" ? `${C.amber}[api]${RST}` : `${C.g4}[pro]${RST}`;
      const bugTag = m.bug ? ` ${C.red}⚑${RST}` : "";
      const meta = `  ${C.dim}[${m.channel === "pro" ? "pro":"api"} · ${((m.latencyMs||0)/1000).toFixed(1)}s · ${(m.tokens||0).toLocaleString()}t]${bugTag}${RST}`;
      const headline = m.title
        ? truncate(m.title, cols - 42)
        : truncate((m.blocks?.[0] as any)?.text || m.cmd || "", cols - 42);

      const rowLine = isActive
        ? `${cursor}${C.green}${BOLD}GREEN: ${RST}${REV} ${headline} ${RST}${C.dim}${meta}`
        : `${cursor}${C.green}${BOLD}GREEN: ${RST}${headline}${C.dim}${meta}`;
      allRows.push(rowLine);

      if (isActive || expanded[m.id]) {
        for (const b of (m.blocks || [])) {
          if (b.kind === "h2") {
            allRows.push(`   ${C.green}${BOLD}${(b.text||"").toUpperCase()}${RST}`);
          } else if (b.kind === "h3") {
            allRows.push(`   ${C.g4}${b.text}${RST}`);
          } else if (b.kind === "p") {
            const words = (b.text || "").split(" ");
            let line = "   ";
            let lineLen = 3;
            for (const w of words) {
              if (lineLen + w.length + 1 > cols - 2) {
                allRows.push(line);
                line = "   " + w + " ";
                lineLen = 3 + w.length + 1;
              } else {
                line += w + " ";
                lineLen += w.length + 1;
              }
            }
            if (lineLen > 3) allRows.push(line);
          } else if (b.kind === "list") {
            for (const it of (b.items as string[])) {
              allRows.push(`   ${C.green}›${RST} ${truncate(String(it), cols - 6)}`);
            }
          } else if (b.kind === "kv") {
            for (const [k, v] of (b.items as [string,string][])) {
              allRows.push(`   ${C.green}${k}:${RST} ${truncate(String(v), cols - k.length - 6)}`);
            }
          } else if (b.kind === "sources") {
            allRows.push(`   ${C.dim}[${(b.items as string[]).length} sources]${RST}`);
          }
        }
        if (m.bug) {
          allRows.push(`   ${C.red}⚑ ${m.bug.severity}: ${truncate(m.bug.description, cols - 8)}${RST}`);
        }
      }
    }
  }

  // Auto-scroll to keep selected row visible
  const selRow = allRows.findIndex(r => r.includes("▌"));
  if (selRow >= 0) {
    if (selRow < transcriptScroll) transcriptScroll = selRow;
    if (selRow >= transcriptScroll + transH) transcriptScroll = selRow - transH + 1;
  }
  transcriptScroll = Math.max(0, Math.min(transcriptScroll, Math.max(0, allRows.length - transH)));

  const visRows = allRows.slice(transcriptScroll, transcriptScroll + transH);
  for (let i = 0; i < transH; i++) {
    lines.push(visRows[i] ?? "");
  }

  // ── trace section ──
  const traceTitle = selMsg
    ? `── trace · ${selMsg.cmd} · ${selMsg.trace!.length} steps · ${((selMsg.latencyMs||0)/1000).toFixed(2)}s · ${selMsg.cost ? `${C.amber}$${selMsg.cost.toFixed(4)}${RST}` : "free"} · conf ${selMsg.confidence}%`
    : "── trace";
  lines.push(`${C.bgBar}${C.dim} ${traceTitle}${RST}`);

  if (selMsg?.trace) {
    const total = selMsg.trace.reduce((a, x) => a + x.t, 0);
    const barW = Math.max(10, cols - 72);
    const traceLines = selMsg.trace.map((step, i) => {
      const svc = SVC[step.svc];
      const pct = total ? Math.round(step.t / total * barW) : 0;
      const bar = "█".repeat(pct) + "░".repeat(Math.max(0, barW - pct));
      const tC = TIER_C[svc?.tier || "free"];
      const rC = RISK_C[svc?.risk || "low"];
      const num = String(i + 1).padStart(2, "0");
      const name = (svc?.name || step.svc).padEnd(20);
      const stepStr = truncate(step.step, 28).padEnd(28);
      return `${C.dim}  ${num}  ${RST}${tC}[${TIER_G[svc?.tier||"free"]}]${RST} ${BOLD}${name}${RST} ${C.dim}${stepStr}  ${tC}${bar}${RST}${C.dim} ${String(step.t).padStart(5)}ms  risk:${rC}${svc?.risk||"?"}${RST}`;
    });
    for (const tl of traceLines.slice(0, traceH - 1)) lines.push(tl);
    // pad to fill trace area
    while (lines.length < rows - 1) lines.push("");
  } else {
    for (let i = 0; i < traceH - 1; i++) lines.push("");
  }

  // ── status bar ──
  let status: string;
  if (filterMode) {
    status = `${C.bgBar}${C.green} / ${RST}${C.bgBar} ${filter}${RST}`;
  } else {
    const kv = (k: string, v: string) => `${C.bgBar}${C.dim}${k}${RST}${C.bgBar}${v}${RST}`;
    const keys = [kv("j/k","nav"), kv("↵","expand"), kv("s","report"), kv("/","filter"), kv("q","quit")].join(`${C.bgBar}  ${RST}`);
    const right = flash ? `${C.bgBar}${C.green} ${flash}${RST}` : selMsg ? `${C.bgBar}${C.dim} ${selMsg.cmd}${RST}` : "";
    const filterTag = filter ? `${C.bgBar}${C.amber} [${filter}]${RST}` : "";
    status = `${C.bgBar} ${keys}${filterTag}   ${right}${RST}`;
  }
  lines.push(status);

  // Simple clear + home + sequential lines with \r\n — works in every terminal.
  process.stdout.write("\x1b[2J\x1b[H" + lines.join("\r\n") + hideCursor(true));
}

// ─── input ────────────────────────────────────────────────────────────────────
function setFlash(msg: string) {
  flash = msg;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flash = ""; render(); }, 1600);
}

function printReport(msg: Msg) {
  const lines = [`\n${C.green}${BOLD}=== ${msg.cmd} — ${msg.title || ""} ===${RST}\n`];
  for (const b of (msg.blocks||[])) {
    if (b.kind === "h2") lines.push(`\n${C.green}${BOLD}${b.text}${RST}`);
    else if (b.kind === "h3") lines.push(`\n${C.g4}${b.text}${RST}`);
    else if (b.kind === "p") lines.push(b.text || "");
    else if (b.kind === "list") for (const it of (b.items as string[])) lines.push(`${C.green}›${RST} ${it}`);
    else if (b.kind === "kv") for (const [k,v] of (b.items as [string,string][])) lines.push(`${C.green}${k}:${RST} ${v}`);
    else if (b.kind === "sources") lines.push(`${C.dim}[${(b.items as string[]).length} sources]${RST}`);
  }
  lines.push(`\n${C.dim}channel:${RST} ${msg.channel}  ${C.dim}latency:${RST} ${((msg.latencyMs||0)/1000).toFixed(2)}s  ${C.dim}tokens:${RST} ${(msg.tokens||0).toLocaleString()}  ${C.dim}cost:${RST} ${msg.cost ? `$${msg.cost.toFixed(4)}` : "free"}  ${C.dim}confidence:${RST} ${msg.confidence}%\n`);
  return lines.join("\n");
}

// ─── main ─────────────────────────────────────────────────────────────────────
const pendingReports: string[] = [];

function cleanup() {
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  } catch (_) {}
  process.stdout.write(altScreen(false) + hideCursor(false));
  if (pendingReports.length) process.stdout.write(pendingReports.join("\n"));
  process.exit(0);
}

process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);
process.on("exit", () => {
  try { process.stdout.write(altScreen(false) + hideCursor(false)); } catch (_) {}
});
process.on("uncaughtException", (err) => {
  cleanup();
});

// Enter alternate screen, then set raw mode, then render.
process.stdout.write(altScreen(true) + hideCursor(true));
try {
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
} catch (_) {}
process.stdin.resume();
process.stdin.setEncoding("utf8");

render();

// Handle terminal resize
process.stdout.on("resize", () => render());

// Read raw bytes from stdin — no readline, no emitKeypressEvents.
// Escape sequences arrive as multi-char strings; single keys as single chars.
process.stdin.on("data", (chunk: string) => {
  if (filterMode) {
    if (chunk === "\r" || chunk === "\n" || chunk === "\x1b") {
      filterMode = false;
    } else if (chunk === "\x7f" || chunk === "\x08") {
      filter = filter.slice(0, -1);
    } else if (chunk.length === 1 && chunk >= " ") {
      filter += chunk;
    }
    render();
    return;
  }

  switch (chunk) {
    case "\x03": // Ctrl-C
    case "q":
      cleanup();
      return;
    case "j":
    case "\x1b[B": // arrow down
      selectedIdx = Math.min(greenMsgs.length - 1, selectedIdx + 1);
      break;
    case "k":
    case "\x1b[A": // arrow up
      selectedIdx = Math.max(0, selectedIdx - 1);
      break;
    case "g":
      selectedIdx = 0;
      break;
    case "G":
      selectedIdx = greenMsgs.length - 1;
      break;
    case "\r":
    case "\n": {
      const id = greenMsgs[selectedIdx]?.id;
      if (id) expanded[id] = !expanded[id];
      break;
    }
    case "s": {
      const msg = greenMsgs[selectedIdx];
      if (msg) {
        pendingReports.push(printReport(msg));
        setFlash(`signal ← ${msg.cmd}`);
      }
      break;
    }
    case "/":
      filterMode = true;
      filter = "";
      break;
    case "\x1b": // Escape — clear filter
      filter = "";
      break;
  }

  render();
});
