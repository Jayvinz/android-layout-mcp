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
