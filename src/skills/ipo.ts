/**
 * /ipo — Upcoming IPO calendar with day-1 open and close price predictions.
 *
 * Prediction methodology grounded in academic literature and practitioner data:
 *   - Subscription demand is the #1 predictor (55% of ML model importance)
 *   - Price revision from initial to final range is a strong secondary signal
 *   - Comparable company multiples set the valuation anchor
 *   - Sector momentum determines the sentiment premium
 *   - Underwriter tier correlates with pricing accuracy
 *
 * Benchmarks embedded in prompt:
 *   - 2025 median first-day pop: 13% | average: 22%
 *   - 2024 average first-day pop: 31%
 *   - 3-5x oversubscribed → expect 20-30% pop
 *   - 10x+ oversubscribed → expect 40%+ pop
 *   - Priced below range → flat or negative day 1
 */
import Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a senior IPO analyst writing a briefing on upcoming initial public offerings for accredited investors. Your tone matches institutional IPO research notes: direct, data-grounded, and opinionated.

CRITICAL INSTRUCTION: Begin your response immediately with "IPO PIPELINE —" on the very first line. No preamble, no introduction.

VOICE AND STYLE
- Direct, institutional research note style — like Renaissance Capital or a bulge-bracket equity research desk
- State predictions with conviction; explain the reasoning in one sentence
- Plain text only — no markdown, no asterisks, no bullet symbols. Signal does not render markdown.
- Use dashes (—) as field separators within a line, blank lines between IPOs
- Keep each IPO entry under 100 words

PREDICTION METHODOLOGY — apply these rules in priority order:

STEP 1 — SECONDARY MARKET ANCHOR (highest weight, use when available):
Private pre-IPO secondary market prices from EquityZen, Forge Global, Nasdaq Private Market, HIIVE, or CartaX are the strongest available predictor of opening price. These platforms reflect what sophisticated accredited investors are paying for shares right now. When a secondary market price exists:
- Use it as the primary anchor for predicted open price
- The secondary price often exceeds the IPO range because it prices in expected day-1 pop
- Apply a 5-10% discount to secondary price for predicted open (float expansion dilutes per-share demand)
- Predicted day-1 close = secondary market price +/- 5% depending on demand signals
- Always report the secondary market price and its source in the Demand field

STEP 2 — SUBSCRIPTION DEMAND SIGNALS (use when secondary price unavailable):
- 3-5x oversubscribed = expect 20-30% pop above IPO price
- 10x+ oversubscribed = expect 40%+ pop
- Undersubscribed = flat or negative
- Price range raised during roadshow = strong demand confirmation

STEP 3 — STRUCTURAL SIGNALS:
- Price revision: priced above initial range = strong demand; priced below range = weak (CoreWeave: $40 vs $47-55 range, closed flat)
- Sector momentum: AI/cloud/space tech carry 20-40% premium; mature/cyclical sectors carry a discount
- Comparable company multiples: IPO priced at discount to peers pops; priced at premium struggles
- Underwriter tier: Goldman Sachs / Morgan Stanley / JPMorgan are Tier 1

BENCHMARKS: 2025 median first-day pop 13%, average 22%; 2024 average 31%

OUTPUT FORMAT — one block per IPO, exactly as follows:

[Company Name] ([TICKER])
Date: [expected IPO date] — Sector: [sector]
Range: $[low]-$[high] — Secondary market: $[price] ([source]) or N/A
Predicted open: $[X] — Predicted day-1 close: $[Y]
Demand: [oversubscribed ~Nx / at parity / undersubscribed — source or inference]
Comparables: [1-2 peer tickers and their current multiples]
Call: [one sentence explaining the prediction — cite secondary market price if used]
Risk: [one sentence on the biggest downside risk to the prediction]

EXAMPLES — study the format and prediction logic only, do not repeat these:

EXAMPLE A (strong pop — AI sector, Tier 1 underwriter, pricing above range):
Astera Labs (ALAB)
Date: March 20 2024 — Sector: AI connectivity semiconductors
Range: $27-$30 — Predicted open: $42 — Predicted day-1 close: $58
Demand: Oversubscribed ~8x; price revised up from initial range to $36
Comparables: MRVL at 12x revenue, CRUS at 9x — ALAB priced at 8x, meaningful discount
Call: Tier 1 bookrunners plus AI-sector tailwind plus below-peer-multiple pricing creates a high-conviction pop; the oversubscription multiple confirms institutional demand well exceeds available float.
Risk: If AI capex narrative softens before lock-up expiry, the premium multiple could compress quickly post-pop.

EXAMPLE B (flat debut — priced below range, muted demand):
CoreWeave (CRWV)
Date: March 28 2025 — Sector: Cloud AI infrastructure
Range: $47-$55 — Predicted open: $39 — Predicted day-1 close: $40
Demand: At parity or undersubscribed; priced at $40, 13% below bottom of range
Comparables: AMZN AWS at 10x revenue, MSFT Azure implied 12x — CRWV priced at ~7x but with far lower margin profile
Call: Pricing below range is the clearest signal of insufficient institutional demand; despite Nvidia backing and AI tailwinds, the margin structure and competition from hyperscalers made the valuation uncompelling at the original range.
Risk: A flat or down first day creates negative sentiment momentum that can persist for weeks as early investors exit.

EXAMPLE C (sector pop — space tech, strong demand):
Firefly Aerospace (FLY)
Date: August 7 2025 — Sector: Commercial space launch
Range: $35-$39 (raised to $41-$43, final $45) — Predicted open: $52 — Predicted day-1 close: $60
Demand: Oversubscribed ~6x; price range raised twice before final pricing
Comparables: RocketLab (RKLB) at 15x revenue; Firefly priced at 11x — 27% discount to direct comparable
Call: A twice-raised price range signals exceptional roadshow demand; the 27% discount to RKLB plus the space-tech momentum premium drives a high-probability pop above $55.
Risk: Commercial launch cadence is lumpy — any mission anomaly before lock-up expiry would punish the stock disproportionately.`;

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const TOOLS: Anthropic.Messages.ToolUnion[] = [
  {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: 15,
  },
];

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------

const INITIAL_PROMPT = `Generate an IPO pipeline briefing for the next 30 days. Use web_search to find:

1. Every IPO expected to price or begin trading in the next 30 days — search "upcoming IPO calendar" and "IPO pipeline next 30 days"

2. For each company found, search for pre-IPO secondary market prices on private share platforms. Search each company name alongside terms like:
   - "[company] EquityZen"
   - "[company] Forge Global"
   - "[company] pre-IPO secondary market price"
   - "[company] private shares price 2026"
   - "[company] Nasdaq Private Market"
   These prices are the strongest predictor of opening price and must be reported when found.

3. For each company: filed price range, sector, lead underwriters, subscription demand commentary, and any analyst price targets

4. Recent comparable IPOs in the same sectors

Search sources: Renaissance Capital, Nasdaq IPO calendar, EquityZen, Forge Global, HIIVE, IPO Monitor, and recent news for each company.

Then write the briefing exactly per the format in your instructions, with a prediction block for every IPO found.`;

const MAX_CONTINUATIONS = 5;

export async function generateIpo(client: Anthropic): Promise<string> {
  const history: Anthropic.MessageParam[] = [
    { role: 'user', content: INITIAL_PROMPT },
  ];

  const allTextParts: string[] = [];
  let continuationCount = 0;

  while (true) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: history,
    });

    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === 'text',
    );
    if (textBlocks.length > 0) {
      allTextParts.push(textBlocks.map(b => b.text).join(''));
    }

    history.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      break;
    }

    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );
      if (toolUseBlocks.length > 0) {
        history.push({
          role: 'user',
          content: toolUseBlocks.map(b => ({
            type: 'tool_result' as const,
            tool_use_id: b.id,
            content: '(search complete)',
          })),
        });
      }
      continue;
    }

    if (response.stop_reason === 'max_tokens') {
      if (continuationCount >= MAX_CONTINUATIONS) break;
      continuationCount++;
      history.push({ role: 'user', content: 'Continue the briefing.' });
      continue;
    }

    return `(unexpected stop: ${response.stop_reason})`;
  }

  const text = allTextParts.join('').trim();
  return text || '(no IPO data found)';
}
