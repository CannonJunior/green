/**
 * /help — Command reference for Green.
 *
 * Add an entry to ENTRIES for every new slash command.
 * See green/CLAUDE.md for the update checklist.
 */

interface HelpEntry {
  /** Primary command name without leading slash, e.g. "best" */
  name: string;
  /** One-line summary shown in the overview listing */
  summary: string;
  /** Usage lines shown in the detail page */
  usage: string[];
  /** Two-to-three sentence description of what the command does */
  description: string;
  /** Flag / argument descriptions */
  options?: { flag: string; desc: string }[];
  /** Concrete invocation examples */
  examples?: string[];
}

// ---------------------------------------------------------------------------
// Command registry — add one entry per slash command
// ---------------------------------------------------------------------------

const ENTRIES: HelpEntry[] = [
  {
    name: 'help',
    summary: 'Command reference. /help <command> for detail on a specific command.',
    usage: ['/help', '/help <command>'],
    description:
      'Lists all available slash commands with a one-line summary. ' +
      'Pass a command name (with or without the leading slash) to see its full ' +
      'usage, description, options, and examples.',
    examples: ['/help', '/help best', '/help /ipo'],
  },
  {
    name: 'reset',
    summary: 'Clear conversation history for your current session.',
    usage: ['/reset'],
    description:
      'Clears the in-memory conversation history that Green maintains per sender. ' +
      'Use this when a conversation has gone off-track or you want a clean context ' +
      'for a new topic. Does not affect any stored data (logs, mood entries, etc.).',
  },
  {
    name: 'projects',
    summary: 'List Claude Code projects configured on this machine.',
    usage: ['/projects'],
    description:
      'Prints the name and description of every project registered in config.yml. ' +
      'Mention a project by name in any natural-language message to direct Claude ' +
      'Code to work within that project\'s directory.',
  },
  {
    name: 'briefing',
    summary: 'System health snapshot: git activity, service status, disk, and uptime.',
    usage: ['/briefing'],
    description:
      'Generates an instant briefing across all configured projects: recent git ' +
      'commits in the last 24 hours, running service status, disk usage, and system ' +
      'uptime. Useful as a morning check-in without leaving the messaging app.',
  },
  {
    name: 'alpha',
    summary: 'Earnings breakout analyzer — scores stocks 0–85 on revenue, margins, and EPS beats.',
    usage: [
      '/alpha',
      '/alpha <TICKER>[,<TICKER>]',
      '/alpha --week',
    ],
    description:
      'Fetches quarterly revenue, gross margin history, and EPS beat/miss records ' +
      'from Alpha Vantage (free key), then scores each stock against the breakout ' +
      'framework: revenue acceleration, margin expansion, and consecutive EPS beats. ' +
      'An Anthropic web-search pass adds forward guidance language and analyst reactions. ' +
      'Bare /alpha shows today\'s earnings reporters. Built for cron-job daily delivery via Signal.',
    options: [
      { flag: 'TICKER[,TICKER]', desc: 'Analyze one to five specific tickers (US or ADR).' },
      { flag: '--week, -w',      desc: 'Show the earnings calendar for the next 7 days.' },
    ],
    examples: [
      '/alpha',
      '/alpha MU',
      '/alpha MU ASML HXSCL',
      '/alpha --week',
    ],
  },
  {
    name: 'bets',
    summary: 'Daily market briefing: top movers, macro theme, and fund-manager takeaway.',
    usage: ['/bets'],
    description:
      'Searches for today\'s S&P 500, Nasdaq, and Dow performance, the top gaining ' +
      'and losing stocks with reasons, and the dominant macro theme. Written in the ' +
      'voice of a senior portfolio manager. Never fabricated — all data from live web search.',
    examples: ['/bets'],
  },
  {
    name: 'ipo',
    summary: 'Upcoming IPO pipeline with price predictions, or a compact symbol list.',
    usage: [
      '/ipo',
      '/ipo <TICKER>[,<TICKER>]',
      '/ipo -d YYYYMMDD',
      '/ipo -symbols',
      '/ipo -s',
    ],
    description:
      'Researches upcoming IPOs using Renaissance Capital, Nasdaq IPO calendar, ' +
      'EquityZen, Forge Global, and recent news. Produces prediction blocks with ' +
      'predicted open price, day-1 close, demand signals, comparables, and risk. ' +
      'Pass specific tickers to focus on those companies only. ' +
      'Use -symbols / -s for a compact ticker-and-date list with no analysis.',
    options: [
      { flag: 'TICKER[,TICKER]', desc: 'Research only these specific upcoming IPOs (comma-separated)' },
      { flag: '-d YYYYMMDD',     desc: 'Find IPOs expected to price on or near this date' },
      { flag: '-symbols, -s',    desc: 'Return a compact list of tickers and expected dates only' },
    ],
    examples: ['/ipo', '/ipo OKLO', '/ipo OKLO,KLTR', '/ipo -d 20260501', '/ipo -s'],
  },
  {
    name: 'best',
    summary: 'Best things to do and upcoming events at a location this week.',
    usage: [
      '/best [location] [-d YYYYMMDD]',
      '/best -default <zip>',
    ],
    description:
      'Searches the web for the best things happening at a given location right now: ' +
      'events, food + drink, outdoors, arts, and sports. Prioritizes picks that are ' +
      'time-sensitive or locally relevant. All results come from live web search — ' +
      'nothing is fabricated.',
    options: [
      { flag: 'location',       desc: 'ZIP code or city name. Uses saved default if omitted.' },
      { flag: '-d YYYYMMDD',    desc: 'Target the briefing around a specific date.' },
      { flag: '-default <zip>', desc: 'Save a new default location for future /best calls.' },
    ],
    examples: ['/best', '/best 22101', '/best New York City', '/best 90210 -d 20260601'],
  },
  {
    name: 'trip',
    summary: 'Plan round-trip flights, lodging, and a rental car between zip codes.',
    usage: [
      '/trip <destination zip> [-d YYYYMMDD]',
      '/trip -default <zip>',
    ],
    description:
      'Resolves zip codes to IATA airport codes, then generates verified search links ' +
      'for round-trip flights (Kayak + Google Flights), hotels (Booking.com + Google ' +
      'Hotels), and rental cars (Kayak Cars). Price estimates are sourced from live ' +
      'search snippets and labeled as approximate. Links are verified to load before ' +
      'being included. Default origin is 22101 (McLean, VA).',
    options: [
      { flag: 'destination zip', desc: 'Destination zip code (required).' },
      { flag: '-d YYYYMMDD',     desc: 'Travel date. Defaults to two weeks from today.' },
      { flag: '-default <zip>',  desc: 'Set a new default origin zip code.' },
    ],
    examples: ['/trip 90210', '/trip 10001 -d 20260701', '/trip -default 20001'],
  },
  {
    name: 'morning',
    summary: 'Personalized morning briefing: weather, health summary, and local context.',
    usage: ['/morning'],
    description:
      'Generates a concise morning briefing covering current weather at your configured ' +
      'location and any locally relevant news or events for today. When health data is ' +
      'sent alongside the command (via the Blue iOS app), it incorporates sleep, HRV, ' +
      'steps, and resting heart rate into the briefing.',
    examples: ['/morning'],
  },
  {
    name: 'clip',
    summary: 'AI processes clipboard content: URL→summary, code→explain, address→nearby.',
    usage: ['/clip [text]', '/clip  (Blue app sends clipboard automatically)'],
    description:
      'Routes clipboard content to the most appropriate AI action: URLs are fetched ' +
      'and summarized in five bullets; addresses show nearby places and events; code ' +
      'snippets are explained concisely; recipes are checked against the Chew pantry; ' +
      'any other text is summarized with key points extracted.',
    options: [
      { flag: 'text', desc: 'Clipboard content. Omit when sending via the Blue iOS app.' },
    ],
    examples: ['/clip https://example.com/article', '/clip 1600 Pennsylvania Ave NW'],
  },
  {
    name: 'mood',
    summary: 'Log your current mood with a numeric rating and optional note.',
    usage: ['/mood <1-5 or emoji> [note]'],
    description:
      'Appends a timestamped mood entry to your personal log. The rating can be a ' +
      'number (1–5) or an emoji. An optional free-text note follows the rating. ' +
      'Entries are stored alongside regular /log entries and included in summaries.',
    options: [
      { flag: '1-5 or emoji', desc: 'Mood rating (required).' },
      { flag: 'note',         desc: 'Optional free-text context.' },
    ],
    examples: ['/mood 4', '/mood 2 rough commute', '/mood 😊 great run this morning'],
  },
  {
    name: 'chew',
    summary: 'Process a food image — routes to receipt scanner or pantry item identifier.',
    usage: ['/chew  (attach an image)'],
    description:
      'Classifies an attached image and routes it to the right Chew module. Kitchen ' +
      'equipment photos go to the equipment identifier; food/pantry photos go to the ' +
      'receipt and pantry processor. Always attach an image; the command does nothing ' +
      'without one.',
    examples: ['/chew  (with a grocery receipt photo attached)'],
  },
  {
    name: 'equipment',
    summary: 'Identify a kitchen item from a photo and add it to Chew.',
    usage: ['/equipment  (attach a photo of the item)'],
    description:
      'Analyzes an attached photo of a kitchen tool, appliance, or gadget, identifies ' +
      'what it is, and adds it to the Chew equipment catalog. More precise than /chew ' +
      'for dedicated equipment identification — use when you know the image is a kitchen ' +
      'item rather than food.',
    examples: ['/equipment  (with a photo of a sous vide circulator)'],
  },
  {
    name: 'log',
    summary: 'Personal log: add entries, summarize by period, search, or view on a map.',
    usage: [
      '/log <text>',
      '/log <text>  (with image attachment for GPS tagging)',
      '/log today|week|month',
      '/log search <query>',
      '/log map',
    ],
    description:
      'Appends timestamped text entries to a local SQLite log. Images with GPS EXIF ' +
      'data are stored with coordinates for map visualization. Summarize or search ' +
      'entries using the AI sub-commands. The map sub-command returns a URL for an ' +
      'interactive map of geotagged images.',
    options: [
      { flag: 'text',           desc: 'Entry text to log.' },
      { flag: 'today|week|month', desc: 'AI summary of entries for that period.' },
      { flag: 'search <query>', desc: 'Semantic search across all entries.' },
      { flag: 'map',            desc: 'URL to the interactive geotagged-image map.' },
    ],
    examples: [
      '/log just finished the trail run',
      '/log  (with a geotagged photo)',
      '/log week',
      '/log search coffee',
      '/log map',
    ],
  },
];

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatOverview(): string {
  const lines: string[] = [
    'Green — personal AI assistant',
    '',
    'COMMANDS',
  ];

  for (const e of ENTRIES) {
    lines.push(`  /${e.name.padEnd(12)} — ${e.summary}`);
  }

  lines.push(
    '',
    'Type /help <command> for full usage, options, and examples.',
    '',
    'CHAT',
    '  Message naturally for anything else — code questions, debugging, web search.',
    '  Prefix with "#api " to route through the Anthropic API directly (reports cost).',
  );

  return lines.join('\n');
}

function formatDetail(entry: HelpEntry): string {
  const lines: string[] = [
    `/${entry.name} — ${entry.summary}`,
    '',
    'USAGE',
    ...entry.usage.map(u => `  ${u}`),
    '',
    'DESCRIPTION',
    // Word-wrap description at ~70 chars with 2-space indent
    ...wordWrap(entry.description, 70, '  '),
  ];

  if (entry.options && entry.options.length > 0) {
    lines.push('', 'OPTIONS');
    const flagWidth = Math.max(...entry.options.map(o => o.flag.length)) + 2;
    for (const o of entry.options) {
      lines.push(`  ${o.flag.padEnd(flagWidth)}${o.desc}`);
    }
  }

  if (entry.examples && entry.examples.length > 0) {
    lines.push('', 'EXAMPLES');
    for (const ex of entry.examples) {
      lines.push(`  ${ex}`);
    }
  }

  return lines.join('\n');
}

function wordWrap(text: string, width: number, indent: string): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = indent;

  for (const word of words) {
    if (current.length > indent.length && current.length + 1 + word.length > width) {
      lines.push(current);
      current = indent + word;
    } else {
      current = current.length > indent.length ? `${current} ${word}` : `${indent}${word}`;
    }
  }
  if (current.length > indent.length) lines.push(current);

  return lines;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the help text for a given command name (with or without leading slash),
 * or the full overview when no name is provided.
 */
export function getHelp(commandName?: string): string {
  if (!commandName) return formatOverview();

  const normalized = commandName.replace(/^\/+/, '').toLowerCase();
  const entry = ENTRIES.find(e => e.name === normalized);

  if (!entry) {
    return (
      `Unknown command: ${commandName}\n\n` +
      `Available commands: ${ENTRIES.map(e => '/' + e.name).join(', ')}\n\n` +
      `Type /help for the full list.`
    );
  }

  return formatDetail(entry);
}
