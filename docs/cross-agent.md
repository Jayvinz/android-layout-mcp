# Cross-agent compatibility

This document records how [Android Layout MCP](https://github.com/Jayvinz/android-layout-mcp) works outside Claude Code: which parts travel, the exact config shapes for each client, the four clients verified on one machine, and the checklist for adding another. The authoritative tool reference stays [mcp.md](mcp.md); this page is the engineering record of the portability work.

## What travels and what does not

The plugin is four layers. Only the top two cross agent boundaries.

| Layer | Contents | Portability |
|---|---|---|
| MCP server | `dist/mcp.js`, stdio, 9 tools | Every MCP client |
| Skills | Four `SKILL.md` files, `name` + `description` frontmatter only | Clients that read Agent Skills directories |
| Slash commands | Five `commands/*.md`, `$ARGUMENTS` syntax | Claude Code only |
| Subagent | `agents/capture-ui.md`, `model: inherit` / `color` | Claude Code only |
| Gate + distribution | `hooks/hooks.json` `PreToolUse`, `plugin.json`, marketplace | Claude Code only |

Two properties make the skills portable: their frontmatter contains only `name` and `description`, and their CLI fallback uses `$AUI_ROOT/dist/cli.js` instead of `${CLAUDE_PLUGIN_ROOT}/dist/cli.js`. In Claude Code `AUI_ROOT` is `${CLAUDE_PLUGIN_ROOT}`; elsewhere it is your plugin checkout, or you can put `android-layout` on `PATH`. Skills never hard-code a Claude-only path in an executable command; `test/agent-portability.test.ts` enforces this.

The Android-project gate is a hard `PreToolUse` hook only in Claude Code. In other clients it is the soft rule written in every skill body: call device tools only in an Android project, or when the user explicitly asks about the device screen.

## Client config envelopes

The server speaks MCP over stdio, so every client can launch it; only the JSON/TOML/YAML envelope differs. Generate one with:

```bash
node dist/cli.js mcp --print-config --client <id>
```

The snippet goes to stdout and the destination hint goes to stderr, so `--client codex > config.toml` produces a clean file. Device and Compose flags (`--serial`, `--adb`, `--timeout`, `--studio`, `--java`, `--compose-version`) are carried into the snippet; `--client` changes the envelope only, never the tool set.

There are 20 client ids across seven shapes:

| Shape | Client ids | Destination |
|---|---|---|
| `mcpServers` object | `claude` (default), `claude-desktop`, `codebuddy`, `workbuddy`, `cursor`, `windsurf`, `devin`, `cline`, `kiro`, `gemini`, `antigravity`, `qwen`, `trae`, `generic` | client's MCP config |
| `servers` + `type: "stdio"` | `vscode` | `.vscode/mcp.json` |
| TOML `[mcp_servers.android-layout]` | `codex` | `~/.codex/config.toml` |
| `context_servers` + `command.path` | `zed` | `settings.json` |
| `mcp` + local command array | `opencode` | `opencode.json` |
| YAML `extensions` | `goose` | `~/.config/goose/config.yaml` |
| dotted `amp.mcpServers` | `amp` | `~/.config/amp/settings.json` |

The ids live in `src/core/mcp-config.ts`; the CLI derives its `--client` choices from that array, so adding an id there is enough for the CLI to accept it. Paths and shapes above are what these clients accepted in November 2026.

## Verified locally

Four clients were exercised end to end on one machine. An "exercise" means the generated config was accepted and at least one MCP call returned real device data, not just a successful handshake.

| Client | Version | Verified behaviour | Gotcha worth remembering |
|---|---|---|---|
| OpenCode | 1.19.5 | `opencode mcp list` reports connected; `tools/list` returns all 9 tools; `opencode debug skill` finds five skills in `.agents/skills/` | Strict config validation; `type: "local"` plus a command array is the accepted shape |
| CodeBuddy Code | 2.186.0 | `mcp__android-layout__list_devices` returns a real device; skills load from `.codebuddy/skills/` | Project servers need one-time approval; headless runs need `--settings '{"enableAllProjectMcpServers":true}'` and often `-y` for gated tools |
| Codex CLI | 0.172.0 | Generated TOML parses; `codex exec` calls `list_devices` and gets a real device; skills in `.agents/skills/` are found | `codex exec` waits on stdin in a non-interactive shell, so redirect from `/dev/null`; a custom provider must use `env_key`, inline `api_key` is ignored |
| WorkBuddy | bundled | After a restart and one-time GUI approval, `list_devices` returns a real device and `capture-ui` loads from `.workbuddy/skills/` | Writing `mcp.json` alone does not expose tools; the GUI enable/trust step is mandatory |

The remaining 16 clients follow their documented schemas but were not run on this machine. Treat any unverified entry as "config shape reviewed, runtime untested".

## Installing the skills elsewhere

`skills/` is the Claude Code plugin layout. Other agents read different directories, so copy the unchanged `SKILL.md` files with:

```bash
npm run sync-skills                                          # .agents/skills in the current project
node scripts/sync-agent-skills.mjs --dest ../my-app          # another project
node scripts/sync-agent-skills.mjs --dest ../my-app --codebuddy
node scripts/sync-agent-skills.mjs --dest ../my-app --workbuddy
node scripts/sync-agent-skills.mjs --dest ../my-app --both
node scripts/sync-agent-skills.mjs --dest ../my-app --both --workbuddy
node scripts/sync-agent-skills.mjs --global                   # ~/.agents/skills
node scripts/sync-agent-skills.mjs --dest . --check           # exit 1 when a copy is stale
```

| Target | Directory | Clients |
|---|---|---|
| default | `.agents/skills/` | Codex CLI, Gemini CLI, Cline, Goose |
| `--codebuddy` | `.codebuddy/skills/` | CodeBuddy Code |
| `--workbuddy` | `.workbuddy/skills/` | WorkBuddy, project or user level |
| no copy needed | `.claude/skills/` | Cursor, VS Code read it directly |

`--both` means the first two targets only: `.agents/skills` plus `.codebuddy/skills`. Add `--workbuddy` as well to write all three. The script is dependency-free, overwrites only these five skills, and never deletes other skills in the destination. `--check` validates each selected target separately.

Cursor and VS Code discover `.claude/skills/` without a copy, so shipping the plugin skills there needs no script.

## Adding another client

Use this checklist so a new client does not silently rot:

1. Add the id to `MCP_CLIENT_IDS` in `src/core/mcp-config.ts`.
2. Add its `CLIENTS` entry with a `family` and an exact destination path. Reuse a family when possible; a new shape needs a branch in `mcpClientConfig`.
3. Add a shape assertion to `test/mcp-config.test.ts`.
4. Update the client table in `docs/mcp.md` and `docs/mcp.zh.md`, and the id list in both READMEs. The compatibility test below fails until all four files mention every id.
5. Update the client count in `AGENTS.md` (currently 20) and this document.
6. If you can run the client, add a row to "Verified locally" with the exact version and what you exercised. Otherwise leave it in the unverified set.
7. Run `npm test`. Do not bump the release version for a client-only change; the server and tools are unchanged.

## Compatibility tests

Three suites guard the contract, and all run without a device or network:

| Test file | Guards |
|---|---|
| `test/mcp-config.test.ts` | Every client emits a non-empty, correctly shaped snippet; TOML escapes Windows paths; unknown ids are rejected |
| `test/agent-portability.test.ts` | Skill frontmatter stays portable; no `${CLAUDE_PLUGIN_ROOT}` in executable paths; sync copies are byte-identical and `--check` detects stale copies |
| `test/cross-agent-compat.test.ts` | Code, CLI and docs agree on the client list; every family keeps its envelope; sync flags and skill directories match the documented matrix |

Run them all with `npm test`. A new client id, a renamed skill directory, or a doc that drops a client will fail one of these tests before release.

## Known limits

- Config formats move. The table reflects November 2026; re-check a client before telling users its path is correct.
- The skills are portable, but slash commands, the subagent, and the `PreToolUse` hook are not. Do not add agent-specific frontmatter fields to `SKILL.md`, or the sync script will ship a field another client rejects.
- Only four clients have runtime verification. The other 16 are documented from their own schema definitions.
- All clients get the same 9 tools. Differences are in config shape, skill discovery, and approval flows, not in tool behaviour.
