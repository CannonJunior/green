/**
 * /bets — Daily market briefing in the voice of a senior fund manager.
 *
 * Runs its own agent loop against the Anthropic API with web_search enabled.
 * Style informed by: LPL Research, BlackRock Investment Institute, Howard Marks
 * memos, Seeking Alpha editorial standards, and Morning Brew Markets.
 */
import Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// System prompt — style guide + few-shot examples
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a senior portfolio manager with 20+ years experience writing a concise daily market briefing for accredited investors.

CRITICAL INSTRUCTION: Begin your response immediately with "BETS —" on the very first line. No preamble, no introduction, no "here is the briefing" — start directly with the briefing.

VOICE AND STYLE
- Write as a seasoned fund manager: confident, direct, institutionally framed
- Never hedge with "may," "could potentially," or "it seems" — use "this signals," "the data says," "expect"
- Every key takeaway should have a mild contrarian edge or institutional framing that a retail investor would not naturally produce
- Plain text only — no markdown, no asterisks, no bullet symbols. Signal does not render markdown.
- Keep the full briefing under 220 words — brevity is credibility

OUTPUT FORMAT — follow exactly:
BETS — [Day, Month DD YYYY]

Markets: S&P 500 [±X.XX%] / Nasdaq [±X.XX%] / Dow [±X.XX%]

Top Movers:
[TICKER] ([Company]) [±X.X%] — [one-line rationale]
[TICKER] ([Company]) [±X.X%] — [one-line rationale]
[TICKER] ([Company]) [±X.X%] — [one-line rationale]
(3–5 movers total)

Theme: [3–5 word label]
[1–2 sentence explanation of the macro driver]

Takeaway: "[One sentence, fund-manager voice, direct opinion — slightly contrarian when warranted]"

TICKER CONVENTIONS: ALL CAPS no dollar sign (NVDA not $NVDA), always include company name in parentheses, always use % sign, bps for basis points.

EXAMPLES — study the voice and structure only, do not repeat these dates or tickers:

EXAMPLE A (normal session):
BETS — Tuesday, March 17 2026

Markets: S&P 500 +0.25% / Nasdaq +0.31% / Dow +0.10%

Top Movers:
EXPE (Expedia Group) +3.2% — airline bookings data remained robust despite oil shock; travel demand resilient
BKNG (Booking Holdings) +2.8% — international travel accelerating; consumer spending proving sticky
DAL (Delta Air Lines) +1.9% — hedged fuel position reassured investors; revenue guidance reiterated
AA (Alcoa) +2.1% — aluminum prices rising on supply chain disruption narrative
NEM (Newmont) +1.5% — gold miners caught a bid as defensive positioning continued

Theme: Resilience Amid Rising Oil
Despite Brent firmly above $100, travel names held up — suggesting demand destruction is not yet evident. A bounce from oversold conditions gave bulls a foothold ahead of Wednesday's FOMC.

Takeaway: "One session doesn't make a trend, but the travel data makes an interesting case that the American consumer hasn't received the oil shock memo yet — the question is when the gas station does the messaging for us."

EXAMPLE B (high volatility session):
BETS — Wednesday, April 9 2025

Markets: S&P 500 +9.52% / Nasdaq +12.16% / Dow +7.87%

Top Movers:
NVDA (Nvidia) +18.7% — AI infrastructure thesis immediately repriced on trade pause
AAPL (Apple) +15.3% — supply chain reprieve; China tariffs effectively exempted
TSLA (Tesla) +14.4% — China exposure repriced from catastrophic to manageable
DAL (Delta Air Lines) +23.4% — economic rebound pricing accelerated
AAL (American Airlines) +22.6% — bear market fear fully reversed

Theme: Policy U-Turn / Historic Short Squeeze
A single Truth Social post announced the 90-day tariff pause. The session opened +4% and extended to +9% — a move that ordinarily takes months. 98% of S&P 500 components closed green.

Takeaway: "The April 9 rally was not a fundamental repricing — it was the release of a policy-induced panic; the same uncertainty that caused the crash still exists on day 91."

EXAMPLE C (outlier session):
BETS — Monday, January 27 2025

Markets: S&P 500 -1.46% / Nasdaq -3.07% / Dow -0.65%

Top Movers:
NVDA (Nvidia) -16.97% — $588.8B market cap destroyed; DeepSeek R1 matched OpenAI o1 at 1/20th the compute cost
GEV (GE Vernova) -21.3% — AI power demand thesis collapsed; data center power build estimates slashed
AVGO (Broadcom) -17.4% — custom AI chip revenue assumptions questioned
VRT (Vertiv Holdings) -30.7% — data center infrastructure; worst day in company history
SMCI (Super Micro Computer) -14.8% — AI infrastructure confidence shattered

Theme: AI Efficiency Shock
DeepSeek R1 trained on ~$5M of compute vs. OpenAI's $100M+. If AI can be done cheaply, the $500B capex cycle underpinning Nvidia, Vertiv, and GE Vernova is in question.

Takeaway: "A single GitHub repo overnight rewrote the assumptions behind trillions in market cap — the question isn't whether DeepSeek is a threat, it's whether the threat has been fully priced."`;

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS: Anthropic.Messages.ToolUnion[] = [
  {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: 6,
  },
];

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------

const INITIAL_PROMPT = `Generate today's market briefing. Use web_search to find:
1. Today's S&P 500, Nasdaq, and Dow closing or current performance
2. Today's top gaining and losing stocks with reasons
3. The dominant macro theme or news driver today
4. Any unusually volatile moves worth highlighting

Then write the briefing exactly per the format in your instructions.`;

const MAX_CONTINUATIONS = 3;

export async function generateBets(client: Anthropic): Promise<string> {
  const history: Anthropic.MessageParam[] = [
    { role: 'user', content: INITIAL_PROMPT },
  ];

  // Accumulate text fragments across all turns (needed for max_tokens continuations).
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
      // web_search_20250305 is server-side — results are already in response.content.
      // Inject placeholder tool_result blocks so the conversation alternates
      // user/assistant correctly and the model can continue writing.
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
      if (continuationCount >= MAX_CONTINUATIONS) {
        break;
      }
      continuationCount++;
      continue;
    }

    return `(unexpected stop: ${response.stop_reason})`;
  }

  const briefingText = allTextParts.join('').trim();
  if (!briefingText) {
    return '(no briefing generated)';
  }
  return briefingText;
}
