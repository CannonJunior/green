// Green — shared dataset.
// Green is a personal AI assistant the user talks to via Signal chat
// (and equivalently in a CLI). Each message either originates from the user
// (a slash-command or natural-language msg) or from Green (the response).
//
// Every Green response carries a `trace` describing the actual processing:
// which APIs/services were called, in order, with their cap/limit/risk and
// individual latency + token contribution.

window.GREEN_DATA = (function () {
  // ─── slash command catalog (mirrors /help) ───
  const COMMANDS = [
    { name: "/help",      desc: "Command reference. /help <command> for detail." },
    { name: "/reset",     desc: "Clear conversation history for current session." },
    { name: "/projects",  desc: "List Claude Code projects on this machine." },
    { name: "/home",      desc: "System health: git activity, services, disk, uptime." },
    { name: "/alpha",     desc: "Earnings breakout analyzer — scores 0–85." },
    { name: "/bets",      desc: "Daily market briefing: movers, macro, takeaway." },
    { name: "/ipo",       desc: "Upcoming IPO pipeline w/ price predictions." },
    { name: "/best",      desc: "Best things to do at a location this week." },
    { name: "/trip",      desc: "Plan round-trip flights, lodging, rental car." },
    { name: "/morning",   desc: "Personalized briefing: weather, health, context." },
    { name: "/clip",      desc: "Process clipboard: URL→summary, code→explain…" },
    { name: "/mood",      desc: "Log mood with numeric rating + note." },
    { name: "/chew",      desc: "Process a food image; receipt or pantry item." },
    { name: "/equipment", desc: "Identify a kitchen item from a photo." },
    { name: "/log",       desc: "Personal log: add, summarize, search, map." },
  ];

  // ─── projects (the user's actual list) ───
  const PROJECTS = [
    ["green",    "The Green AI assistant itself"],
    ["best",     "Best things occurring at present location"],
    ["bets",     "Financial market summaries"],
    ["chew",     "All things food to chew on"],
    ["warchief", "Browser-based 3D game; you are the Warchief"],
    ["decor",    "Browser application for the home"],
    ["red",      "Robobrain"],
    ["yellow",   "Private"],
    ["blue",     "Framework for iOS app to integrate with Siri / iOS"],
    ["log",      "Personal log with image and GPS support"],
    ["trip",     "Round-trip flights, lodging, rental cars between zip codes"],
  ];

  // ─── service catalog (caps / limits / tier / risk) ───
  const SERVICES = [
    { id: "claude-pro",     name: "Claude Code Pro",      tier: "pro",   cap: "session quota",     limit: "shared with chat",   risk: "med",  proto: "OAuth session",    cost: 0 },
    { id: "anthropic-api",  name: "Anthropic Messages",   tier: "paid",  cap: "$ / M tokens",      limit: "tier-3 rate-limit",  risk: "low",  proto: "Bearer sk-ant-…",  cost: 3.0 },
    { id: "ollama",         name: "Ollama (local)",       tier: "free",  cap: "unlimited",         limit: "8B params, 4k ctx",  risk: "med",  proto: "loopback",         cost: 0 },
    { id: "qdrant",         name: "Qdrant (vector)",      tier: "free",  cap: "unlimited",         limit: "200 res / call",     risk: "low",  proto: "API key (local)",  cost: 0 },
    { id: "local-cache",    name: "Local cache",          tier: "free",  cap: "unlimited",         limit: "5min TTL",           risk: "low",  proto: "in-process",       cost: 0 },
    { id: "signal-cli",     name: "signal-cli",           tier: "free",  cap: "unlimited",         limit: "1 device link",      risk: "low",  proto: "linked device",    cost: 0 },
    { id: "github-rest",    name: "GitHub REST",          tier: "free",  cap: "5,000 / hr",        limit: "PAT scope",          risk: "low",  proto: "PAT",              cost: 0 },
    { id: "polygon",        name: "Polygon.io",           tier: "paid",  cap: "100 req / min",     limit: "stocks plan",        risk: "low",  proto: "API key",          cost: 0.0001 },
    { id: "alpha-vantage",  name: "Alpha Vantage",        tier: "free",  cap: "5 req / min",       limit: "daily 500",          risk: "med",  proto: "API key",          cost: 0 },
    { id: "perplexity",     name: "Perplexity Sonar",     tier: "paid",  cap: "$ / call",          limit: "rate-limited",       risk: "low",  proto: "Bearer",           cost: 0.005 },
    { id: "yfinance",       name: "yfinance (scrape)",    tier: "free",  cap: "best-effort",       limit: "may break unannounced", risk: "high", proto: "HTTP",          cost: 0 },
    { id: "sec-edgar",      name: "SEC EDGAR",            tier: "free",  cap: "10 req / sec",      limit: "must set User-Agent",risk: "low",  proto: "HTTP",             cost: 0 },
    { id: "openweather",    name: "OpenWeather",          tier: "free",  cap: "1,000 / day",       limit: "free tier",          risk: "low",  proto: "API key",          cost: 0 },
    { id: "google-places",  name: "Google Places",        tier: "paid",  cap: "$ / call",          limit: "billing alerts",     risk: "low",  proto: "API key",          cost: 0.017 },
    { id: "ticketmaster",   name: "Ticketmaster Discovery", tier: "free", cap: "5,000 / day",      limit: "consumer key",       risk: "low",  proto: "API key",          cost: 0 },
    { id: "skyscanner",     name: "Skyscanner",           tier: "paid",  cap: "20 req / sec",      limit: "partner agreement",  risk: "med",  proto: "API key",          cost: 0.002 },
    { id: "amadeus",        name: "Amadeus Travel",       tier: "paid",  cap: "10 req / sec",      limit: "test→prod gate",     risk: "med",  proto: "OAuth2",           cost: 0.003 },
    { id: "apple-health",   name: "Apple Health (HK)",    tier: "free",  cap: "device-local",      limit: "needs companion app",risk: "med",  proto: "HealthKit bridge", cost: 0 },
    { id: "filesystem",     name: "Local filesystem",     tier: "free",  cap: "unlimited",         limit: "—",                  risk: "low",  proto: "fs",               cost: 0 },
    { id: "git",            name: "git",                  tier: "free",  cap: "unlimited",         limit: "—",                  risk: "low",  proto: "shell",            cost: 0 },
  ];

  const svcMap = Object.fromEntries(SERVICES.map(s => [s.id, s]));

  // ─── conversation log ───
  const TODAY = new Date("2026-04-26T14:28:02");
  const t = (h, m, s = 0) => { const x = new Date(TODAY); x.setHours(h, m, s, 0); return x.getTime(); };

  const conversation = [
    // ── Morning briefing
    { id: "m001", role: "user", ts: t(7, 14), text: "/morning" },
    { id: "m002", role: "green", parent: "m001", ts: t(7, 14, 11), cmd: "/morning", channel: "pro",
      title: "Good morning briefing — Apr 26",
      blocks: [
        { kind: "h2", text: "Weather" },
        { kind: "p",  text: "Partly cloudy, 64°F → 78°F. 10% rain after 3pm. Wind SW 8mph." },
        { kind: "h2", text: "Health (last 24h)" },
        { kind: "list", items: ["Steps: 6,412", "Sleep: 7h 22m (REM 1h 41m)", "RHR: 58 bpm — normal range"] },
        { kind: "h2", text: "Local" },
        { kind: "p",  text: "Farmer's market 9–1 at Riverside. Coffee shop on 5th opens 7:30 today (1h late)." },
      ],
      tokens: 2840, cost: 0, latencyMs: 3210, score: 88, confidence: 91,
      trace: [
        { svc: "local-cache",   step: "miss",                                    t: 12,   tokens: 0 },
        { svc: "apple-health",  step: "fetch sleep + activity (last 24h)",       t: 380,  tokens: 0 },
        { svc: "openweather",   step: "forecast for 30.27,-97.74",               t: 240,  tokens: 0 },
        { svc: "qdrant",        step: "retrieve user prefs + saved spots",       t: 95,   tokens: 0 },
        { svc: "claude-pro",    step: "compose briefing",                        t: 2480, tokens: 2840 },
      ],
    },

    // ── Mood
    { id: "m003", role: "user", ts: t(7, 21), text: "/mood 7 ready for the day" },
    { id: "m004", role: "green", parent: "m003", ts: t(7, 21, 1), cmd: "/mood", channel: "pro",
      blocks: [{ kind: "p", text: "Logged mood: 7/10 — \"ready for the day\". 14-day average: 6.4." }],
      tokens: 80, cost: 0, latencyMs: 410, score: 100, confidence: 100,
      trace: [
        { svc: "filesystem",    step: "append ~/.green/mood.jsonl",              t: 8,   tokens: 0 },
        { svc: "qdrant",        step: "embed for retrieval",                     t: 38,  tokens: 0 },
        { svc: "claude-pro",    step: "format ack",                              t: 360, tokens: 80 },
      ],
    },

    // ── Best things
    { id: "m005", role: "user", ts: t(11, 2), text: "/best this weekend" },
    { id: "m006", role: "green", parent: "m005", ts: t(11, 2, 9), cmd: "/best", channel: "pro",
      title: "Best things — weekend of Apr 25–26",
      blocks: [
        { kind: "list", items: [
          "Fri 8pm — Indie film festival opener at the Paramount ($14)",
          "Sat 9–1 — Riverside farmer's market (cash only)",
          "Sat 7pm — Astros vs Rangers @ Globe Life ($28+)",
          "Sun 11am — Wildflower walk at McKinney Falls (free)",
        ] },
      ],
      tokens: 1560, cost: 0.017, latencyMs: 4120, score: 82, confidence: 78,
      trace: [
        { svc: "local-cache",    step: "miss (last fetch >24h)",                 t: 10,   tokens: 0 },
        { svc: "google-places",  step: "events near 30.27,-97.74 r=20mi",        t: 880,  tokens: 0 },
        { svc: "ticketmaster",   step: "events Apr 25–26",                       t: 620,  tokens: 0 },
        { svc: "qdrant",         step: "filter by user taste vectors",           t: 110,  tokens: 0 },
        { svc: "claude-pro",     step: "rank + summarize",                       t: 2500, tokens: 1560 },
      ],
    },

    // ── Projects
    { id: "m007", role: "user", ts: t(14, 28, 2), text: "/projects" },
    { id: "m008", role: "green", parent: "m007", ts: t(14, 28, 4), cmd: "/projects", channel: "pro",
      title: "Available projects",
      blocks: [
        { kind: "kv", items: PROJECTS.map(([k, v]) => [k, v]) },
      ],
      tokens: 220, cost: 0, latencyMs: 240, score: 100, confidence: 100,
      trace: [
        { svc: "filesystem",    step: "scan ~/code/* for .green-project.toml",   t: 32,  tokens: 0 },
        { svc: "git",           step: "git -C <each> rev-parse",                 t: 110, tokens: 0 },
        { svc: "claude-pro",    step: "format list",                             t: 98,  tokens: 220 },
      ],
    },

    // ── Alpha
    { id: "m009", role: "user", ts: t(14, 28, 24), text: "/alpha" },
    { id: "m010", role: "green", parent: "m009", ts: t(14, 28, 41), cmd: "/alpha", channel: "api",
      title: "ALPHA — 2026-04-26 — Earnings today: NE",
      blocks: [
        { kind: "p", text: "Checking today's earnings…" },
        { kind: "h2", text: "ALPHA — NE (Noble Corporation)" },
        { kind: "p",  text: "Score: 0/85 — MONITOR" },
        { kind: "h3", text: "Signals" },
        { kind: "p",  text: "No significant breakout signals detected." },
        { kind: "h3", text: "Context" },
        { kind: "p",  text: "Q1 2026 results scheduled today after-close, call Apr 27. Most recent confirmed report is FY2025: revenue $3.286B (beat, YoY decline); EPS missed, shares −4%. 2026 guidance: revenue $2.8–3.0B, adj. EBITDA $0.94–1.02B. JPMorgan downgraded to Neutral (Dec 2025); BTIG raised PT to $42 (Feb 2026). Primary risk: offshore day rates moving sideways." },
        { kind: "sources", items: [
          "stocktitan.net/news/NE/noble-corporation-plc-to-announce-first-quarter-2026",
          "prnewswire.com/news-releases/noble-corporation-plc-announces-fourth-quarter-and-full-year-2025-results",
          "investing.com/news/company-news/noble-q4-2025-slides-eps-miss-overshadows-revenue-beat",
          "marketscreener.com/news/noble-q4-adjusted-earnings-revenue-decline-2026-guidance-set",
          "finance.yahoo.com/news/jpmorgan-downgrades-noble-corporation-ne",
          "finance.yahoo.com/news/noble-corporation-ne-price-target-191312547",
        ] },
      ],
      tokens: 12480, cost: 0.0374, latencyMs: 16200, score: 71, confidence: 64,
      trace: [
        { svc: "local-cache",   step: "miss",                                    t: 12,    tokens: 0 },
        { svc: "polygon",       step: "today's earnings calendar",               t: 320,   tokens: 0 },
        { svc: "alpha-vantage", step: "NE fundamentals (rev/EPS/margin)",        t: 1840,  tokens: 0 },
        { svc: "sec-edgar",     step: "NE 10-K + 8-K (FY2025)",                  t: 980,   tokens: 0 },
        { svc: "perplexity",    step: "analyst notes since Dec 2025",            t: 2210,  tokens: 0 },
        { svc: "yfinance",      step: "price + 60d chart",                       t: 720,   tokens: 0 },
        { svc: "qdrant",        step: "user portfolio bias",                     t: 88,    tokens: 0 },
        { svc: "anthropic-api", step: "score + write-up",                        t: 10030, tokens: 12480 },
      ],
      bug: { description: "Response began streaming the previous /projects output before the ALPHA block. Terminal redraw race when long messages overlap.", severity: "minor" },
    },

    // ── Trip
    { id: "m011", role: "user", ts: t(15, 12), text: "/trip 78704 to 94110 may 8-12" },
    { id: "m012", role: "green", parent: "m011", ts: t(15, 12, 22), cmd: "/trip", channel: "api",
      title: "Trip plan — Austin (78704) ↔ San Francisco (94110), May 8–12",
      blocks: [
        { kind: "h3", text: "Flight (round-trip)" },
        { kind: "p",  text: "AUS ↔ SFO, United nonstop. Out 8:15a Fri / Back 6:45p Mon. $284 / pax." },
        { kind: "h3", text: "Lodging" },
        { kind: "p",  text: "Mission Hotel, 4 nights, $189/nt. 0.6mi from 94110 centroid." },
        { kind: "h3", text: "Rental car" },
        { kind: "p",  text: "Compact (Hertz, SFO). $43/day · 4 days = $172. Decline if staying in 94110." },
        { kind: "p",  text: "Total ≈ $1,212 (1 pax). Cheaper option: skip car, use Muni/BART (−$172)." },
      ],
      tokens: 4220, cost: 0.0127, latencyMs: 9800, score: 79, confidence: 81,
      trace: [
        { svc: "skyscanner",    step: "fares AUS↔SFO May 8–12",                 t: 1620, tokens: 0 },
        { svc: "amadeus",       step: "lodging 94110 ±2mi 4-nt",                t: 2240, tokens: 0 },
        { svc: "amadeus",       step: "car rental SFO 4-day",                   t: 980,  tokens: 0 },
        { svc: "google-places", step: "neighborhood scoring",                   t: 410,  tokens: 0 },
        { svc: "anthropic-api", step: "compose itinerary + tradeoffs",          t: 4550, tokens: 4220 },
      ],
    },

    // ── Reset
    { id: "m013", role: "user", ts: t(16, 4), text: "/reset" },
    { id: "m014", role: "green", parent: "m013", ts: t(16, 4, 1), cmd: "/reset", channel: "pro",
      blocks: [{ kind: "p", text: "Conversation history cleared for this session. Embeddings retained." }],
      tokens: 24, cost: 0, latencyMs: 80, score: 100, confidence: 100,
      trace: [
        { svc: "filesystem",    step: "rm ~/.green/sessions/<id>.jsonl",         t: 14, tokens: 0 },
        { svc: "claude-pro",    step: "ack",                                     t: 66, tokens: 24 },
      ],
    },

    // ── #api natural-language
    { id: "m015", role: "user", ts: t(16, 41), text: "#api compare confidence between yfinance and polygon for NE today" },
    { id: "m016", role: "green", parent: "m015", ts: t(16, 41, 14), cmd: "#api", channel: "api",
      blocks: [
        { kind: "p", text: "Polygon last trade $32.41 (T+0.4s). yfinance last trade $32.39 (T+62s, scraped). For today's close-of-day decisions either is fine; for intraday triggers prefer Polygon. yfinance has been flaky 2× this week — see service health on the right." },
      ],
      tokens: 1840, cost: 0.0055, latencyMs: 4210, score: 86, confidence: 88,
      trace: [
        { svc: "polygon",       step: "NE last trade",                           t: 180,  tokens: 0 },
        { svc: "yfinance",      step: "NE last trade (scrape)",                  t: 1320, tokens: 0 },
        { svc: "anthropic-api", step: "compare + write up",                      t: 2710, tokens: 1840 },
      ],
    },

    // ── Clip
    { id: "m017", role: "user", ts: t(17, 3), text: "/clip" },
    { id: "m018", role: "green", parent: "m017", ts: t(17, 3, 7), cmd: "/clip", channel: "pro",
      blocks: [
        { kind: "p", text: "Clipboard contains a URL → routed to summarize." },
        { kind: "p", text: "\"How small teams ship: 6 patterns from teams under 10 engineers.\" Concise summary: focus on shared on-call, tight code review loops, and shipping daily over weekly retros. ~7 min read." },
      ],
      tokens: 980, cost: 0, latencyMs: 2840, score: 84, confidence: 80,
      trace: [
        { svc: "filesystem",    step: "read clipboard via xclip",                t: 18,  tokens: 0 },
        { svc: "local-cache",   step: "miss (URL not seen)",                     t: 8,   tokens: 0 },
        { svc: "claude-pro",    step: "fetch URL + summarize",                   t: 2810, tokens: 980 },
      ],
    },
  ];

  return { COMMANDS, PROJECTS, SERVICES, svcMap, conversation };
})();
