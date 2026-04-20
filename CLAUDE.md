# Green — Personal AI Assistant

Green is the central messaging daemon that receives commands via Signal (or other channels) and routes them to the appropriate handler or Claude Code project.

## Architecture

- **Entry point:** `src/index.ts` — `handleMessage()` dispatches all slash commands
- **Channels:** Signal, local stdin/stdout, OpenClaw Gateway, Mobile (Blue iOS app)
- **Config:** `config.yml` — projects, approved numbers, model, channel settings
- **Agent loop:** `src/agent.ts` — Anthropic API with web search and tool use
- **Subprocess agent:** `src/skills/subprocess-agent.ts` — Claude Code CLI for project work

Slash command modules (best, bets, trip, log, chew) live in sibling directories under `/home/junior/src/` and are imported as `file:` dependencies in `package.json`.

## Adding a New Slash Command

1. Create the module in `/home/junior/src/<name>/` following the pattern in `/home/junior/src/best/`.
2. Add it to `green/package.json` dependencies: `"<name>": "file:../<name>"`.
3. Import and wire the handler in `src/index.ts` `handleMessage()`.
4. Register the project in `config.yml` under `projects:`.
5. **Update `/help` in `src/help.ts`** — add an entry to the `ENTRIES` array with:
   - `name` — command name without leading slash
   - `summary` — one-line description for the overview listing
   - `usage` — all valid invocation forms
   - `description` — 2–3 sentence explanation
   - `options` — flags and arguments (if any)
   - `examples` — concrete example invocations

The `/help` command reads exclusively from `src/help.ts`. The handler in `src/index.ts` contains no help text of its own. **Every new slash command must have a corresponding entry in `src/help.ts` before the PR is merged.**

## Running Locally

```
npm run dev:local    # stdin/stdout (no Signal required)
npm run dev          # Signal channel
npm run dev:gateway  # OpenClaw Gateway
```

## Environment

Copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`.
