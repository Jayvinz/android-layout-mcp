# Trigger evals

Routing regression suite for the three skills. It checks that a prompt activates the intended skill and calls the intended MCP tools, and that general Android or coding questions activate nothing.

## Layout

```text
evals/
├── README.md
├── mocks/layout-inspector-android/   # fixed JSON result per MCP tool (<tool>.md, no frontmatter)
└── trigger-*/                        # one case per routing scenario
    ├── prompt.md                     # user prompt + case frontmatter
    └── graders/*.md                  # tool_used graders (skill activation, required/missing tools)
```

Each case sets `runs: 1`, `allowed_tools`, `max_turns: 8`, `timeout_seconds: 180`, and `tags: [trigger]`. The MCP server is mocked, so no device, adb, or Android Studio is needed.

`mocks/layout-inspector-android/_tools.json` is a saved `tools/list` snapshot; it gives the mocked server the real tool names, descriptions, and schemas. Regenerate it after any `src/mcp.ts` change (rebuild `dist/` first) so the eval sees the shipped descriptions. If the file is absent, mocked tools fall back to a permissive schema with no description.

## Running

```bash
# one case (smoke)
claude plugin eval . --case 'trigger-dump-current-screen' --runs 1 --ablation none --trust-plugin --no-publish --max-cost-usd 1

# whole suite (11 cases)
claude plugin eval . --case 'trigger-*' --runs 1 --ablation none --trust-plugin --no-publish --max-cost-usd 4
```

Results land in `evals/results/<timestamp>/aggregate-result.json` and are gitignored. Use `--runs 3` for a stability check; `--ablation with-without` additionally runs a no-plugin baseline arm.

Some multi-step workflows reach the 8-turn cap after their graders have already passed. That appears as `exit 1: Reached maximum number of turns` and keeps the run's temp sandbox, but it does not change the score. Raise `max_turns` when you need the full final answer rather than just the routing decision.

## Cost

About $2.50–$3.50 for this 11-case suite at `--runs 1` (observed $2.72; a single smoke case is roughly $0.15–$0.30). A `--runs 3` stability pass costs roughly 3×. The `--max-cost-usd` ceiling is checked before each run launches; a low ceiling stops the run early rather than failing a case.

## Windows

On native Windows the eval harness does not grant Bash to cases. That is fine here: every mock returns a fixed result and no case uses a scaffold script. Run the commands from Git Bash or PowerShell; quoting above works in both.
