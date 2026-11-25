# Android Layout MCP

[English](README.md) | [简体中文](README.zh.md)

![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)
![Node.js ≥ 20](https://img.shields.io/badge/node-%E2%89%A520-green.svg)
![CI](https://github.com/Jayvinz/android-layout-mcp/actions/workflows/validate.yml/badge.svg)

**An MCP server and coding-agent plugin that lets an agent see the live Android screen — and find the code behind it.**

Coding agents read repositories well but cannot look at the phone. This project gives them that view. It captures the current screen over ADB, normalizes four Android data sources into one node tree with short refs, and answers questions about it:

- What is on this screen? → `dump_ui`
- Where is this element, and is it clickable? → `find_elements` / `hit_test`
- Does the layout have issues? → `analyze_ui` with 12 rules
- Which Compose or XML file, and which business logic, renders it? → `locate_code` plus the bundled skills

## Highlights

| Highlight | What it means for you |
|---|---|
| **Four sources, one tree** | View hierarchy (JDWP), accessibility semantics (uiautomator), `dumpsys activity`, and the Compose inspector (JVMTI) all produce the same `UiNode` shape — one workflow regardless of screen type. |
| **Zero-config `auto` mode** | Picks per screen: View for XML, semantics for Compose, both for mixed screens. No flags to remember for everyday use. |
| **Works on release builds** | `dumpsys` reads real View classes, resource ids, and Fragment structure with no debuggable app. It merges semantics text by measured geometry, not a hard-coded offset. |
| **UI → source without an index** | `locate_code` scans the repository for text, id, class, and Composable anchors and returns ranked `file:line` candidates. No Gradle sync, no language server, no build required. |
| **Available where you work** | 9 MCP tools, a coding-agent plugin (5 skills + 5 commands + gate hook), and documented configs for 20 MCP clients. |
| **No native dependencies** | Pure JavaScript, Node ≥ 20. Screenshots are downscaled in JS; nothing to compile but the optional Compose helper. |

## Requirements

- Node.js ≥ 20 (the MCP server runs on Node)
- `adb` on `PATH` (or `ALM_ADB` / `ADB_PATH`), with a device or emulator and USB debugging on
- A debuggable app for the `view` and `compose` sources; `semantics` and `dumpsys` work on any app
- Android Studio + Java only for the `compose` source (~8–12 s per capture)

## Install and connect

### Coding agent plugin (recommended)

In Claude Code:

```text
/plugin marketplace add Jayvinz/android-layout-mcp
/plugin install android-layout@jayvinz-tools
```

The plugin starts the MCP server automatically and adds the skills, commands, and gate hook. After installing, `/mcp` should list `android-layout` and `/help` should list the `/android-layout:*` commands. **Restart Claude Code once** so the hook loads.

Offline alternatives:

```bash
# Release bundle (self-contained, includes production node_modules)
claude --plugin-dir ./android-layout-mcp-<version>.zip

# Local checkout (build first; a local-path marketplace does not install deps for you)
npm install && npm run build
claude --plugin-dir E:/repo/android-layout-mcp
```

### Any other MCP client

The server speaks plain stdio MCP, so any client can start it. Clone the repository, build once, and point the client at `dist/mcp.js`:

```json
{
  "mcpServers": {
    "android-layout": {
      "command": "node",
      "args": ["<your-clone>/dist/mcp.js"]
    }
  }
}
```

Add `--serial`, `--adb`, `--timeout`, or the Compose flags (`--studio`, `--java`, `--compose-version`) to `args` to pin a device or toolchain. VS Code, Codex, Zed, Goose, OpenCode, Amp, and other clients use a different envelope — [docs/mcp.md](docs/mcp.md) lists all 20 ids and the shape for each.

To get the five skills as well, copy them into the directory your agent reads:

```bash
node scripts/sync-agent-skills.mjs --dest <your-android-project>
# --codebuddy, --workbuddy, --both, --global, --check, --dry-run
```

Cursor and VS Code read `.claude/skills/` directly, so they need no copy. Claude Code is the only client with slash commands and the enforced gate; elsewhere the gate is the rule written in each skill body.

Names: the repository and npm package are `android-layout-mcp`; the MCP server key and plugin slug are `android-layout`. The package is not published to the registry — install the plugin or load the release zip.

## First run

```text
/mcp                        # confirm the android-layout server is loaded
/android-layout:capture     # capture the current screen
```

Or just ask: "当前界面有什么？" A `dump_ui(source="auto", format="tree")` reply looks like this:

```
device <serial> (Pixel 7)  android 13 (sdk 33)
screen 1080x2400 @ 440dpi (2.75x) portrait
target com.example.app.debug pid=9597 activity=...MainActivity debuggable
primary source: view (captured: view, semantics)
ui kind: xml
view window: .../android.view.ViewRootImpl@60b9a5d (100ms)
semantics rotation=0 (900ms)

v0 DecorView [0,0][1080,2400] 1080x2400 @(540,1200)
  v1 FrameLayout [0,0][1080,2400] 1080x2400 @(540,1200)
    v2 FrameLayout id/content [0,0][1080,2400] 1080x2400 @(540,1200)
```

Then put the app on the page you care about and ask:

> Locate the **Me** button on the current screen and trace it to its related code logic.

Or run `/android-layout:trace-view Me`. The agent confirms the foreground app, captures the tree, locks onto the node, scans for `file:line` candidates, and reads the code. For a whole block, say "分析这块区域的业务逻辑" (or "analyze this block's logic") and it follows UI → state → data instead.

## Upper-layer components

Skills, commands, and MCP tools are layers over one shared core.

### MCP tools (9)

| Tool | Answers | Key parameters |
|---|---|---|
| `list_devices` | Which devices are connected? | — |
| `get_state` | Screen, foreground app, pid, ViewRootImpl windows | `serial`, `package` |
| `dump_ui` | What is the whole tree? | `source`, `format=json\|tree`, `depth`, `maxNodes`, `includeProperties`, `visibleOnly`, `window`, `savePath` |
| `find_elements` | Where is this text / id / class / ref? | `query`, `by`, `match`, `clickable`, `both`, `includeInvisible`, `limit` |
| `hit_test` | What is at (x, y)? | `x`, `y`, `index`, `source` |
| `locate_code` | Which source file renders this element? | `text[]`, `desc[]`, `id[]`, `className[]`, `composeName`, `composeFile` + `composeLine`, `root`, `limit`, `includeTests`, `exclude[]` |
| `analyze_ui` | Does the layout have issues? | `rules[]`, `minTouchTargetDp` (48), `maxDepth` (14), `includeProperties` |
| `screenshot` | What does it look like? | `maxWidth` (720), `scale`, `fullResolution`, `savePath`, `annotate` |
| `list_fragments` | Activity / Fragment structure | `package`, `includeFramework` |

Recommended call order: `get_state` → `dump_ui(source="auto", format="tree")` → `find_elements` or `hit_test` → optional `screenshot` / `analyze_ui`. Call `locate_code` only when the user asks for source. Full reference: [docs/mcp.md](docs/mcp.md).

### Skills (Claude Code and other agents)

Five skills split on two axes — granularity and intent — so each cell has exactly one owner:

| | Facts | Property values | Source code | Defects |
|---|---|---|---|---|
| **One element** | `capture-ui` (locate part) | `inspect-view-attribute` | `trace-view-wiring` | — |
| **One section** | — | — | `trace-ui-logic` | — |
| **Whole screen** | `capture-ui` | — | — | `audit-ui` |

| Skill | Ask it for | Typical prompt |
|---|---|---|
| `capture-ui` | Structure, Activity, `uiKind`, entry points, coordinates, saved artifacts | "当前界面有什么", "抓取当前页面布局" |
| `inspect-view-attribute` | One View's margins, padding, measured size, text metrics, background, RTL | "这个按钮的边距是多少" |
| `trace-view-wiring` | One element's class, click handler, visibility rule, content injection | "这个按钮在哪实现的" |
| `trace-ui-logic` | One block's UI → state holder → data source chain (read-only) | "这块区域的业务逻辑", "这个列表数据从哪来" |
| `audit-ui` | Defect judgments, each tied to the XML/Composable that causes it | "有没有重叠", "布局有没有问题" |

### Slash commands (Claude Code)

| Command | Argument |
|---|---|
| `/android-layout:capture` | optional block or package |
| `/android-layout:inspect-view` | element text / id / ref |
| `/android-layout:trace-view` | element text / id / ref |
| `/android-layout:trace-logic` | the block to trace |
| `/android-layout:ui2logic` | alias of `trace-logic` |
| `/android-layout:audit` | optional block |

Commands are thin entry points: they bind `$ARGUMENTS`, name their skill, and carry one gate pointer. The rules live in the skills, never in both places.

### Gate hook

All nine device-touching tools are Android-project gated. The plugin's `PreToolUse` hook denies them in a non-Android workspace unless the latest user prompt explicitly asks about the device screen or mentions Android. `locate_code` is stricter: it needs an Android project or an explicit Android mention. Detection uses `settings.gradle(.kts)`, `gradlew(.bat)`, a module applying `com.android.*`, or `AndroidManifest.xml`. A connected device does not make a repository Android. Set `ALM_GATE_DEBUG=1` to log decisions.

### Scripts

```bash
# Rank source candidates from UI anchors, no npm install needed
node scripts/locate-code.mjs --root . --text "登录" --id "login_btn" --compose-name "LoginScreen" --json

# Copy the five skills into another agent's skill directory
node scripts/sync-agent-skills.mjs --dest ../my-android-app --both
```

`locate-code.mjs` only ranks candidates; always open the files to confirm. It never modifies the repository.

## How it reads the screen

| Source | Requires | Gives | Cost |
|---|---|---|---|
| `view` (JDWP) | Debuggable app | Real View classes, resource ids, text, padding/margins, layout params, visibility | ~100 ms |
| `semantics` (uiautomator) | Nothing | Text, content descriptions, clickable bounds — accessibility roles instead of real classes | ~0.5–3 s |
| `dumpsys` (ActivityManager) | Nothing | Real View classes, resource ids, window bounds, Activity/Fragment records; text merged in from semantics | ~100–300 ms |
| `compose` (JVMTI) | Debuggable app + Android Studio + Java | Composable names, `file:line`, bounds, parameters, recomposition counts | ~8–12 s |

On a Compose screen the `view` source stops at `AndroidComposeView` — that is why `auto` switches to semantics, and why `source=compose` exists for Composable-level answers. Details and measured per-source results: [docs/data-sources.md](docs/data-sources.md).

## Things to know

- **Refs are per capture.** `v*` (view), `s*` (semantics), `d*` (dumpsys), `c*` (compose) are valid only for the capture that produced them. To compare before/after, match on source, resource id, class, text, and path.
- **Artifacts are local.** The capture workflow writes `.alm/capture.json`, `.alm/capture.png`, and `.alm/capture.xml`. Add `.alm/` to `.gitignore`; dumps can contain device serials, package names, and screen text. Android Studio's Layout Inspector cannot open these files (`.li` is private).
- **Image coordinates ≠ device coordinates.** A downscaled screenshot reports `coordinateMapping.imageToDevice`; multiply before hit-testing or quoting a position. Values from `find_elements` / `hit_test` are already device coordinates.
- **Screenshots are a fallback, not the source of truth.** When structured capture fails, a downscaled `alm-fallback-<time>.png` is saved and returned as image content. Disable with `ALM_NO_FALLBACK_SCREENSHOT=1`.
- **Common environment variables:** `ALM_ADB` / `ADB_PATH`, `ANDROID_SERIAL`, `ALM_ANDROID_STUDIO`, `ALM_JAVA`, `ALM_COMPOSE_VERSION`, `ALM_NO_FALLBACK_SCREENSHOT`. Full table: [docs/cli.md](docs/cli.md#environment-variables).
- **JDWP allows one debugger at a time.** Attach can fail while Android Studio is debugging the same app.
- **Canvas-drawn pixels have no nodes.** Custom `Canvas` drawing, `SurfaceView`, and `WebView` content expose no children or text; the semantics tree only shows what the app reports to accessibility.
- **Limits:** `dump_ui` caps JSON at 800 nodes and the tree at 1500 unless you raise `maxNodes`; `savePath` writes the untrimmed dump. The `compose` source needs Android Studio + Java 17+ and takes ~8–12 s.
- **Contributing:** `dist/` is intentionally committed (marketplace installs run it without a build), and `package.json` is the only version source. Run `npm run build` after changing `src/` and commit `dist/` in the same change. See [AGENTS.md](AGENTS.md) and [docs/development.md](docs/development.md).

## Documentation

| Document | Contents |
|---|---|
| [docs/plugin.md](docs/plugin.md) | Coding-agent plugin: install paths, bundle, release |
| [docs/mcp.md](docs/mcp.md) | Tool reference, client configs, defaults, limits, call order |
| [docs/cli.md](docs/cli.md) | Analysis rules, environment variables, shared flags |
| [docs/data-sources.md](docs/data-sources.md) | How each tree is read and where it stops |
| [docs/cross-agent.md](docs/cross-agent.md) | All 20 clients, skill portability, verified runs |
| [docs/development.md](docs/development.md) | Development, tests, packaging constraints |
| [blog/](blog/) | Two-part walkthrough: getting started, and how the capture works |

Chinese counterparts are `docs/*.zh.md`.

## License

MIT — see [LICENSE](LICENSE). The TypeScript implementation is independent. Protocol and hit-testing behavior follow [CoXier/LayoutInspectorV2-Pro](https://github.com/CoXier/LayoutInspectorV2-Pro) (Apache-2.0) and AOSP `android.view.ViewDebug` / `DdmHandleViewDebug` / ddmlib; the Compose tree reads the transport, JVMTI agent, and `androidx.compose.ui:ui-inspection` from a local Android Studio at runtime. [NOTICE](NOTICE) records all of it.