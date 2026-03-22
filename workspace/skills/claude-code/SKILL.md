# Claude Code Skill

This skill lets you run Claude Code prompts against projects on the Linux machine.

## When to use

Use this skill when junior:
- Asks about code in a specific project ("why are the tests failing?")
- Asks you to write, fix, or refactor something
- Asks you to investigate a bug or error
- Asks you to run an analysis or review

## Tool: run_claude_code

Parameters:
- `project_name` (required): must match one of the configured project names
- `prompt` (required): the full question or instruction to pass to Claude Code

## Behaviour

- Before invoking, confirm which project is targeted if the message is ambiguous
- After invoking, summarize the key result in 1-2 sentences
- If the output is longer than ~300 words, summarize and offer to share the full text
- If Claude Code returns an error, include the error message verbatim

## Example messages → tool calls

"why are the green tests failing?"
→ run_claude_code(project_name="green", prompt="why are the tests failing? Show me the error and the likely cause.")

"add a health check endpoint to the API project"
→ run_claude_code(project_name="api", prompt="add a /health GET endpoint that returns {status: ok} with HTTP 200")

"what does the config loader do in green?"
→ run_claude_code(project_name="green", prompt="explain what src/config.ts does")
