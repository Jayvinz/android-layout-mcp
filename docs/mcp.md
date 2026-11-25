# MCP server

[English](mcp.md) | [简体中文](mcp.zh.md)

The MCP server speaks MCP over stdio and exposes the same core as the CLI, so any MCP client can drive it. Start the built server with `node dist/mcp.js`, or print a config shaped for 20 clients with `node dist/cli.js mcp --print-config --client <id>` (the default `mcpServers` shape shown below works for Claude Code and several others). The [cross-agent guide](cross-agent.md) records the full client matrix and verified runs.

## Configuration

Claude Code (`.mcp.json` at the project root):

```json
{
  "mcpServers": {
    "android-layout": {
      "command": "node",
      "args": ["E:/repo/android-layout-mcp/dist/mcp.js"]
    }
  }
}
```

Or with the CLI:

```bash
claude mcp add android-layout -- node E:/repo/android-layout-mcp/dist/mcp.js
```

(Examples use the repository name `android-layout` in the path; substitute your actual directory if different.)

The MCP server also accepts the Compose-related flags: `--studio <path>`, `--java <path>`, `--compose-version <v>`.

Multiple devices / custom adb:

```json
{
  "mcpServers": {
    "android-layout": {
      "command": "node",
      "args": [
        "E:/repo/android-layout-mcp/dist/mcp.js",
        "--serial", "<serial>",
        "--adb", "D:/Android/Sdk/platform-tools/adb.exe",
        "--timeout", "30000"
      ]
    }
  }
}
```

When installed through the Claude Code plugin no manual configuration is needed: the plugin manifest's `mcpServers` starts `${CLAUDE_PLUGIN_ROOT}/dist/mcp.js` automatically (see [plugin.md](plugin.md)).

### Other clients

The server is a plain stdio MCP server, so any client can run it; only the config envelope differs. `--client` prints the shape that client expects, with the snippet on stdout and the destination path on stderr:

```bash
node dist/cli.js mcp --print-config --client codex > config.toml
```

The 20 ids are `claude` (default), `claude-desktop`, `codebuddy`, `workbuddy`, `cursor`, `windsurf`, `devin`, `cline`, `kiro`, `gemini`, `antigravity`, `qwen`, `trae`, `vscode`, `codex`, `zed`, `opencode`, `goose`, `amp`, and `generic`. [cross-agent.md](cross-agent.md#client-config-envelopes) has the destination file and envelope shape for each, and the skill install flags.

Four clients were exercised end to end on a real machine: OpenCode, CodeBuddy Code, Codex CLI, and WorkBuddy. [cross-agent.md](cross-agent.md#verified-locally) records their versions and the per-client gotchas.

The global flags (`--serial`, `--adb`, `--timeout`, `--studio`, `--java`, `--compose-version`) are carried into the snippet, so a pinned device survives the copy. `--client` reshapes the envelope only; the tools are identical everywhere.

Config formats move, so treat the recorded paths and shapes as a November 2026 snapshot, and use `%USERPROFILE%` on Windows where a path starts with `~`.

## Tools

| Tool | Purpose |
|---|---|
| `list_devices` | Device list |
| `get_state` | Screen, foreground app, pid, windows |
| `dump_ui` | Capture UI; `source=auto/view/semantics/dumpsys/compose/both`, `format=json/tree`, `depth`, `maxNodes`, `includeProperties`, `visibleOnly`, `window`, `savePath`. JSON carries one key per captured tree (`view`, `semantics`, `dumpsys`, `compose`); `source=dumpsys` adds a `dumpsys` object with `activity`, `captureMs`, `labelledNodes`, `fragments`, and `roots` |
| `find_elements` | Search by text/description/id/class/ref; returns bounds, center, clickable, full path |
| `locate_code` | Scan an Android repository from UI anchors (text/desc/id/Compose file+line/class) and return string/layout/Compose definitions plus ranked `file:line` candidates |
| `hit_test` | Coordinate hit test; the default (`source=auto`) queries view and semantics together; any explicit `source` — `view`, `semantics`, `dumpsys`, or `compose` — is honoured and hit-tests only that tree |
| `analyze_ui` | Layout/accessibility checks over all 12 rules (see [cli.md](cli.md#analysis-rules)); raw View properties are captured by default so `overdraw` and `rtl_issues` can run; it scans the tree matching the screen (both trees for a mixed screen), so one defect is never reported per tree |
| `screenshot` | Returns PNG image content; downscaled to 720px wide by default (`fullResolution=true` to disable); can save and produce an SVG overlay |
| `list_fragments` | Activity and Fragment structure from `dumpsys`; works on non-debuggable apps. Framework bookkeeping fragments are filtered unless `includeFramework` is set |

**Android project gate.** All nine tools touch a device and are gated the same way: `list_devices`, `get_state`, `dump_ui`, `find_elements`, `locate_code`, `hit_test`, `analyze_ui`, `list_fragments`, `screenshot`. They are intended for Android projects: `settings.gradle(.kts)`, `gradlew(.bat)`, a module `build.gradle(.kts)` applying `com.android.*`, or `AndroidManifest.xml`. In a non-Android repository, every device-touching tool is denied unless the user explicitly asks to inspect the device screen/page or explicitly mentions Android; `locate_code` is stricter and needs an Android project or an explicit Android mention, because a device cue alone does not justify source scanning. A connected device does not make the repository Android. Each of the nine tool descriptions repeats the rule in one line: "Android repos only; non-Android: call only on an explicit device/screen request or Android mention." The `PreToolUse` hook enforces the same nine-tool gate, so the hook and the descriptions cannot drift apart.

## Limits and defaults

| Tool | Defaults | Caps and behavior |
|---|---|---|
| `dump_ui` | JSON; JSON `maxNodes=800`, tree `maxNodes=1500` | `depth` 0–100; `maxNodes` 1–5000; `includeProperties` embeds every ViewDebug property; `savePath` writes the full untrimmed dump; `visibleOnly` affects `format=tree` only; `window` selects a ViewRootImpl (view source only). The JSON `hint` names the ref prefix of the captured source: `v*` view, `s*` semantics, `c*` compose, `d*` dumpsys |
| `find_elements` | `limit=30`, visible nodes, primary tree | `limit` 1–200; `includeInvisible` adds hidden views; `both=true` searches view + semantics; `match=contains/exact/regex`, and `/pattern/flags` is accepted as regex |
| `locate_code` | `limit=25` candidates | `limit` 1–200; `exclude` / `includeTests` scope the scan; read-only |
| `analyze_ui` | all 12 rules, 48 dp, depth 14, `includeProperties=true` | `minTouchTargetDp` 1–200; `maxDepth` 1–100; `deep_nesting` is skipped for the compose source; `includeProperties=false` skips the raw View capture, and `overdraw`/`rtl_issues` are then reported under `skipped`; it scans the tree the `source` selects (both trees for a mixed screen), so one defect is never reported per tree |
| `screenshot` | 720 px wide | `maxWidth` 1–4000; `scale` 0.05–1; `fullResolution=true` bypasses the 720 default; `annotate` only writes the SVG when `savePath` is also set |
| `hit_test` | candidate 0, visible nodes only, `source=auto` (view + semantics) | `index` selects among overlapping candidates at the same point; an explicit `source` restricts the search to that one tree |

When a capture fails, tools return the error text plus a fallback screenshot as image content.

## Recommended call order

1. `get_state` → confirm the foreground app;
2. `dump_ui(source="auto", format="tree")` or `find_elements` → view the screen / locate;
3. `screenshot` → visual confirmation;
4. `analyze_ui` → check small touch targets, overlap, clipping, etc.;

### Summarizing the current screen

```text
get_state → dump_ui(source="auto", format="tree") → find_elements (named element) → optional analyze_ui / screenshot
```

This is observation only. Call `locate_code` only when the user asks for source.

### Locating UI source code

```text
get_state → dump_ui(source="auto") → (Compose screens) dump_ui(source="compose")
→ find_elements / hit_test → locate_code → read candidate files → report file:line and the business chain
```

`locate_code` takes the text/desc/id/Compose name/file/line/class found in the previous step; it only ranks candidates and never modifies the repository. Standalone usage of the locate script `scripts/locate-code.mjs` is documented in [plugin.md](plugin.md#locate-script).

### Tracing a UI block to its business code and logic

```text
get_state → dump_ui(source="auto", format="tree") → (separate dialog window) dump_ui(source="view", window=...)
→ locate_code → read candidate files → ViewModel/state → Repository/API/cache → state/data chain with confirmed|inferred hops
```

Use this for "这块区域的业务逻辑" or "从这块 UI 追到业务代码": start from the named UI block, identify whether it belongs to a page, dialog, or bottom sheet, map its sections to `file:line`, then follow state and data 1–3 hops. It is read-only and never edits code. The `trace-ui-logic` skill and `/android-layout:trace-logic` command encode this workflow.

## Environment variables

The MCP process inherits the user's shell environment; the full variable table lives in [cli.md](cli.md#environment-variables). To pin serial/adb/Studio parameters, prefer environment variables or pass them explicitly as server args (see the configuration examples above).
