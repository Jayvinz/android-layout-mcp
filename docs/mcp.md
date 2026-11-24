# MCP server

[English](mcp.md) | [简体中文](mcp.zh.md)

The MCP server speaks MCP over stdio and exposes the same core as the CLI. Start the built server with `node dist/mcp.js`, or print a client config with `node dist/cli.js mcp --print-config`.

## Configuration

Claude Code (`.mcp.json` at the project root):

```json
{
  "mcpServers": {
    "android-ui": {
      "command": "node",
      "args": ["E:/repo/android-ui-inspector/dist/mcp.js"]
    }
  }
}
```

Or with the CLI:

```bash
claude mcp add android-ui -- node E:/repo/android-ui-inspector/dist/mcp.js
```

(Examples use the repository name `android-ui-inspector` in the path; substitute your actual directory if different.)

The MCP server also accepts the Compose-related flags: `--studio <path>`, `--java <path>`, `--compose-version <v>`.

Multiple devices / custom adb:

```json
{
  "mcpServers": {
    "android-ui": {
      "command": "node",
      "args": [
        "E:/repo/android-ui-inspector/dist/mcp.js",
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

The server is a plain stdio MCP server, so any client can run it; only the config envelope differs. `--client` prints the shape that client expects. The destination file goes to stderr, so stdout stays a paste-ready snippet:

```bash
node dist/cli.js mcp --print-config --client codex > config.toml
```

| `--client` | File | Shape |
|---|---|---|
| `claude` (default), `claude-desktop`, `cursor`, `windsurf`, `devin`, `cline`, `kiro`, `gemini`, `antigravity`, `qwen`, `trae`, `generic` | client's MCP config | `mcpServers` object |
| `vscode` | `.vscode/mcp.json` | `servers` with `type: "stdio"` |
| `codex` | `~/.codex/config.toml` | TOML `[mcp_servers.android-ui]` |
| `zed` | `settings.json` | `context_servers` with `command.path` |
| `opencode` | `opencode.json` | `mcp` with a local command array |
| `goose` | `~/.config/goose/config.yaml` | YAML `extensions` |
| `amp` | `~/.config/amp/settings.json` | dotted `amp.mcpServers` key |

The global flags (`--serial`, `--adb`, `--timeout`, `--studio`, `--java`, `--compose-version`) are carried into the snippet, so a pinned device survives the copy. `--client` reshapes the envelope only; the tools are identical everywhere.

Client config formats move; the paths and shapes above are what these clients accepted in November 2026. Windows uses `%USERPROFILE%` where the table says `~`.

### Skills in other agents

The four skills are written to run outside Claude Code too: their frontmatter uses only `name` and `description` (the portable subset of the Agent Skills standard), and their bodies resolve the CLI through `AUI_ROOT` instead of `${CLAUDE_PLUGIN_ROOT}`. Cursor and VS Code read `.claude/skills/` directly; Codex CLI, Gemini CLI, Cline, and Goose read `.agents/skills/`:

```bash
node scripts/sync-agent-skills.mjs --dest ../my-android-app   # install into a project
node scripts/sync-agent-skills.mjs --global                   # ~/.agents/skills
node scripts/sync-agent-skills.mjs --dest . --check           # exit 1 when the copy is stale
```

Set `AUI_ROOT` to the plugin checkout (or put `android-ui` on `PATH`) in that project so the CLI fallback resolves. The slash commands (`/screen`, `/locate`, …) and the `ui-code-locator` subagent are Claude Code specific; other clients reach the same workflows through the skills and tool descriptions. The `PreToolUse` gate hook is also Claude Code only — elsewhere the Android-project gate is the soft rule written in every skill body.

## Tools

| Tool | Purpose |
|---|---|
| `list_devices` | Device list |
| `get_state` | Screen, foreground app, pid, windows |
| `dump_ui` | Capture UI; `source=auto/view/semantics/compose/both`, `format=json/tree`, `depth`, `maxNodes`, `savePath` |
| `find_elements` | Search by text/description/id/class/ref; returns bounds, tap center, clickable, full path |
| `locate_code` | Scan an Android repository from UI anchors (text/desc/id/Compose file+line/class) and return string/layout/Compose definitions plus ranked `file:line` candidates |
| `hit_test` | Coordinate hit test; returns view and semantics by default; `source=compose` reaches the Compose tree |
| `analyze_ui` | Layout/accessibility checks (rules in [cli.md](cli.md#analysis-rules)) |
| `screenshot` | Returns PNG image content; downscaled to 720px wide by default (`fullResolution=true` to disable); can save and produce an SVG overlay |
| `open_viewer` | Capture once, write a self-contained offline HTML viewer (tree, screenshot overlay, details, issues), and open it in the browser |
| `diff_ui` | Compare two JSON files written by `dump_ui(savePath)` |
| `tap` | Tap by coordinate or by `text/id/ref`; supports `imageX/imageY/imageWidth/imageHeight` image-coordinate mapping |
| `swipe` / `input_text` / `press_key` | Interaction |

**Android project gate.** `get_state`, `dump_ui`, `find_elements`, `locate_code`, and `open_viewer` are intended for Android projects: `settings.gradle(.kts)`, `gradlew(.bat)`, a module `build.gradle(.kts)` applying `com.android.*`, or `AndroidManifest.xml`. In a non-Android repository call them only when the user explicitly asks to inspect the device screen/page or explicitly mentions Android; `locate_code` additionally needs an explicit Android/device request. A connected device does not make the repository Android.

## Limits and defaults

| Tool | Defaults | Caps and behavior |
|---|---|---|
| `dump_ui` | JSON; JSON `maxNodes=800`, tree `maxNodes=1500` | `depth` 0–100; `maxNodes` 1–5000; `includeProperties` embeds every ViewDebug property; `savePath` writes the full untrimmed dump; `visibleOnly` affects `format=tree` only; `window` selects a ViewRootImpl (view source only) |
| `find_elements` | `limit=30`, visible nodes, primary tree | `limit` 1–200; `includeInvisible` adds hidden views; `both=true` searches view + semantics; `match=contains/exact/regex`, and `/pattern/flags` is accepted as regex |
| `locate_code` | `limit=25` candidates | `limit` 1–200; `exclude` / `includeTests` scope the scan; read-only |
| `analyze_ui` | all 10 rules, 48 dp, depth 14 | `minTouchTargetDp` 1–200; `maxDepth` 1–100; `deep_nesting` is skipped for the compose source |
| `screenshot` | 720 px wide | `maxWidth` 1–4000; `scale` 0.05–1; `fullResolution=true` bypasses the 720 default; `annotate` only writes the SVG when `savePath` is also set |
| `open_viewer` | `.aui/viewer.html`, 4000 nodes/tree, 1080 px | `maxNodes` 1–20000; `includeProperties` adds ViewDebug properties (off by default); `includeIssues` runs analysis (on by default); 8 MB embedded-JSON budget — properties are dropped first, then nodes are halved to a floor of 200 |
| `diff_ui` | `tolerance=1` px | `tolerance` 0–100; one tree per run (`source`); both inputs must be dumps written by `dump_ui(savePath=...)` |
| `hit_test` | candidate 0, visible nodes only | `index` selects among overlapping candidates at the same point |
| `tap` | first visible match | image mapping needs all four `image*` arguments; a selector matches visible nodes only; `index` picks among matches (default 0) |
| `swipe` | 300 ms | `durationMs` 1–10000 |

`input_text` accepts ASCII only (spaces are sent as `%s`); `press_key` forwards the value to `adb shell input keyevent`, so use `KEYCODE_*` names or numeric codes. When a capture fails, tools return the error text plus a fallback screenshot as image content.

## Recommended call order

1. `get_state` → confirm the foreground app;
2. `dump_ui(source="auto", format="tree")` or `find_elements` → view the screen / locate;
3. `tap` → interact;
4. `screenshot` → visual confirmation;
5. `analyze_ui` → check small touch targets, overlap, clipping, etc.;
6. After a code change: `dump_ui(savePath=before.json)` … `dump_ui(savePath=after.json)` → `diff_ui`.

`open_viewer` is outside this order: call it only on an explicit visual request such as "打开可视化看看", "在浏览器里打开当前页面", "可视化当前布局", or "open the UI viewer". It opens a browser window as a visible side effect, so `dump_ui`, `find_elements`, `analyze_ui`, `screenshot`, `diff_ui`, and verification must not call it. Pass `open=false` (or set `AUI_NO_OPEN=1`) to write the HTML without launching a browser; the tool returns `{path, opened, browser?, openError?, bytes, uiKind, sources, truncated, screenshot}`.

### Summarizing the current screen

```text
get_state → dump_ui(source="auto", format="tree") → find_elements (named control) → optional analyze_ui / screenshot
```

This is observation only. Call `locate_code` only when the user asks for source, and `diff_ui` only for before/after comparisons.

### Locating UI source code

```text
get_state → dump_ui(source="auto") → (Compose screens) dump_ui(source="compose")
→ find_elements / hit_test → locate_code → read candidate files → report file:line and the business chain
```

`locate_code` takes the text/desc/id/Compose name/file/line/class found in the previous step; it only ranks candidates and never modifies the repository. Standalone usage of the locate script `scripts/locate-code.mjs` is documented in [plugin.md](plugin.md#locate-script).

### Analyzing the current screen/dialog logic

```text
get_state → dump_ui(source="auto", format="tree") → (separate dialog window) dump_ui(source="view", window=...)
→ locate_code → read candidate files → ViewModel/state → Repository/API/cache → state/data chain with confirmed|inferred hops
```

Use this for "分析当前界面/弹窗的代码和业务逻辑": identify whether the surface is a page, dialog, or bottom sheet; map its sections to `file:line`; then follow state and data 1–3 hops. It is read-only and never edits code. The `analyze-screen-logic` skill and `/android-ui:analyze-screen` command encode this workflow.

## Environment variables

The MCP process inherits the user's shell environment; the full variable table lives in [cli.md](cli.md#environment-variables). To pin serial/adb/Studio parameters, prefer environment variables or pass them explicitly as server args (see the configuration examples above).
