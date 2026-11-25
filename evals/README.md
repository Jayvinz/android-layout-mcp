# Trigger evals

Routing regression suite for the five skills. It checks that a prompt activates the intended skill and calls the intended MCP tools, that general Android or coding questions activate nothing, and that the Android project gate blocks non-Android workspaces unless the user explicitly asks for the device screen/page or mentions Android.

## Layout

```text
evals/
├── README.md
├── mocks/android-layout/   # fixed JSON result per MCP tool (<tool>.md, no frontmatter)
├── fixtures/android-project/         # fake Android repo for scaffolded cases
├── trigger-*/                        # one case per routing scenario
│   ├── prompt.md                     # user prompt + case frontmatter
│   └── graders/*.md                  # tool_used graders (skill activation, required/missing tools)
├── scaffold-*/                       # case.yaml + scaffold.sh; run with --scaffold
└── manual-gate-*/                    # non-Android refusal prompts for manual/installed-plugin runs
```

There are 15 `trigger-*` cases, one `scaffold-*` case, and two `manual-gate-*` prompts. Trigger cases set `runs: 1`, `allowed_tools`, `max_turns: 8`, `timeout_seconds: 180`, and `tags: [trigger]`. The MCP server is mocked, so no device, adb, or Android Studio is needed.

`mocks/android-layout/_tools.json` is a saved `tools/list` snapshot; it gives the mocked server the real tool names, descriptions, and schemas. Regenerate it after any `src/mcp.ts` change (rebuild `dist/` first) so the eval sees the shipped descriptions. If the file is absent, mocked tools fall back to a permissive schema with no description.

## Running

```bash
# one case (smoke)
claude plugin eval . --case 'trigger-dump-current-screen' --runs 1 --ablation none --trust-plugin --no-publish --max-cost-usd 1

# whole trigger suite (15 cases)
claude plugin eval . --case 'trigger-*' --runs 1 --ablation none --trust-plugin --no-publish --max-cost-usd 6
```

Results land in `evals/results/<timestamp>/aggregate-result.json` and are gitignored. Use `--runs 3` for a stability check; `--ablation with-without` additionally runs a no-plugin baseline arm.

Some multi-step workflows reach the 8-turn cap after their graders have already passed. That appears as `exit 1: Reached maximum number of turns` and keeps the run's temp sandbox, but it does not change the score. Raise `max_turns` when you need the full final answer rather than just the routing decision.

## Gate cases

The eval workspace is empty, so it is not an Android project. Existing positive prompts carry an explicit `在一个 Android 工程中，` (or `In an Android project, `) prefix, which is the gate's Android-mention exception. The dedicated cases cover the rest:

- `trigger-exception-device` — an explicit device/screen request activates observation only;
- `trigger-exception-android` — an explicit Android mention activates source analysis;
- `manual-gate-nonandroid-*` — reference prompts for the non-Android refusal. `claude plugin eval` does not load plugin hooks, so these are not in the `trigger-*` glob; the deterministic gate is covered by `test/android-gate.test.ts` and by the `PreToolUse` hook in an installed plugin session.

## Runtime gate

`hooks/hooks.json` registers a `PreToolUse` command hook (`hooks/alm-android-gate.mjs`) for all nine device-touching tools: `list_devices`, `get_state`, `dump_ui`, `find_elements`, `locate_code`, `hit_test`, `analyze_ui`, `list_fragments`, and `screenshot`. In a non-Android workspace it denies every one of them unless the latest user prompt explicitly asks about a device screen/page or mentions Android; `locate_code` additionally requires an Android project or an explicit Android mention. Hooks load at session start, so restart Claude Code after installing or updating the plugin. The eval harness does not load plugin hooks, which is why the negative checks are manual here and unit-tested separately.

## Scaffolded Android workspace

`scaffold-android-workspace-analyze` stages a fake Android project into the empty run cwd with `context.scaffold_script`, then asks to analyze the current screen **without** an Android mention. It validates the real project-detection branch (not just the explicit-Android exception) and must be run with `--scaffold`:

```bash
claude plugin eval . --case 'scaffold-android-workspace-analyze' --scaffold --runs 1 --ablation none --trust-plugin --no-publish --max-cost-usd 2
```

The script runs host-side as `bash` with the empty workspace as cwd (Git Bash on Windows; the WSL launcher must not be first on PATH). `context.add_dirs` is not a workspace copy — it only grants read access to files inside the case directory, so it cannot make the cwd look like an Android project.

## Cost

About $4–$7 for the 15 `trigger-*` cases at `--runs 1` (the analyze cases are the most expensive because they explore several files; a single smoke case is roughly $0.15–$0.30). The `scaffold-*` case is a separate run with its own ceiling, and the two `manual-gate-*` prompts are run by hand in an installed plugin session. A `--runs 3` stability pass costs roughly 3×. The `--max-cost-usd` ceiling is checked before each run launches; a low ceiling stops the run early rather than failing a case.

## Windows

On native Windows the eval harness does not grant Bash to cases. That is fine here: every mock returns a fixed result and no case uses a scaffold script. Run the commands from Git Bash or PowerShell; quoting above works in both.
