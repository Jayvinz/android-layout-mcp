# Android UI Inspector

|                      |                      |
| -------------------- | -------------------- |
| [English](README.md) | [简体中文](README.zh.md) |

![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)

![Node.js ≥ 20](https://img.shields.io/badge/node-%E2%89%A520-green.svg)

![CI](https://github.com/Jayvinz/android-ui-inspector/actions/workflows/validate.yml/badge.svg)

**Android UI inspection for coding agents.** Read the live screen of a real device or emulator over ADB, search and hit-test elements, capture annotated screenshots, run layout/accessibility checks, diff before/after layouts, and trace any control back to its Compose/XML source and business logic.

Inspired by [LayoutInspectorV2-Pro](https://plugins.jetbrains.com/plugin/21047-layoutinspectorv2-pro).

## Highlights

- **Adaptive data sources** — `auto` picks the right tree per screen: ViewDebug v2 for XML, accessibility semantics for Compose, and both for mixed screens. Opt into the Compose JVMTI tree for Composable names and `file:line`.
- **Find, hit-test, interact** — search by text / content-description / resource-id / class / ref, resolve every element under a coordinate (smallest area first), then tap, swipe, or input.
- **Visual verification** — screenshots with SVG node overlays and automatic image→device coordinate mapping; a fallback screenshot is saved automatically when structured capture fails.
- **Interactive viewer on request** — say "打开可视化看看" and get a self-contained offline HTML file (tree, screenshot overlay, node details, layout issues) opened in your browser. It never opens a browser as a side effect of other commands.
- **Checks and diffs** — 10 layout/accessibility rules and identity-keyed before/after diffs around a code change.
- **UI → source locator** — turn UI anchors into ranked `file:line` candidates, string/layout/Compose definitions, and click handlers. Read-only: it never edits the repo.
- **One core, two front ends** — the CLI and the MCP server share the same `capture()` / `treesFor()` pipeline, so behavior does not diverge.

## Naming

| Layer | Name |
| --- | --- |
| GitHub repository | `Jayvinz/android-ui-inspector` |
| Claude Code plugin and marketplace entry | `android-ui` |
| Plugin display name | Android UI Inspector |
| CLI command | `android-ui` |
| MCP server key | `android-ui` |

Version 1.0.0 is the first stable release (2026-11-24); the earlier name was never published, so
there is nothing to migrate: install the plugin and run `android-ui`. The gate hook is read at
session start, so restart Claude Code once after installing.

## Architecture

```
CLI (android-ui) ──┐
                   ├── core ──┬── JDWP + DDM → ViewDebug v2 view tree
MCP Server ────────┘          ├── adb uiautomator → semantics tree
                              └── Android Studio transport + JVMTI → Compose tree
```

## Quick start

### Prerequisites

- Node.js ≥ 20 (required by the plugin / MCP / CLI)
- Android platform-tools: `adb` on `PATH`, or set `AUI_ADB` / `ADB_PATH`
- A device or emulator with USB debugging enabled; the target app running in the foreground
- The `view` / `compose` sources require a debuggable build (`android:debuggable=true`); `semantics` has no such requirement
- For the Claude Code plugin, Claude Code must be able to invoke `node` / `npm` from `PATH`

### 1. Install the Claude Code plugin (recommended)

```text
/plugin marketplace add Jayvinz/android-ui-inspector
/plugin install android-ui@jayvinz-tools
```

After installation you get:

| Component               | Content                                                                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP server `android-ui` | `dump_ui`, `find_elements`, `locate_code`, `hit_test`, `analyze_ui`, `screenshot`, `open_viewer`, `diff_ui`, `tap`, and more                                          |
| Slash commands          | `/android-ui:locate` (UI→source), `:screen` (current screen), `:analyze-screen` (screen/dialog logic), `:view` (browser viewer), `:verify` (verify changes on device) |
| Skills                  | `inspect-current-screen`, `locate-ui-code`, `analyze-screen-logic`, `verify-ui-change`                                                                                |
| Read-only subagent      | `ui-code-locator`                                                                                                                                                     |

Use `/mcp` to confirm the server is loaded; `/help` lists the commands above.

Prefer not to add the marketplace? Each release also ships a self-contained plugin bundle (built
`dist/`, helper jar, and production dependencies) that loads without cloning — see
[docs/plugin.md](docs/plugin.md#plugin-bundle):

```text
claude --plugin-dir ./android-ui-inspector-<version>.zip
```

**Local development/debugging**: run `npm install && npm run build` in the repository root first, then point the marketplace at your local path (substitute your actual clone path):

```text
/plugin marketplace add E:/repo/android-ui-inspector
/plugin install android-ui@jayvinz-tools
```

See [docs/plugin.md](docs/plugin.md) for the component list and versioning.

### 2. Connect the MCP server (other clients)

```bash
node dist/cli.js mcp --print-config --client cursor
```

`--client` accepts `claude`, `claude-desktop`, `codebuddy`, `workbuddy`, `cursor`, `windsurf`, `devin`, `cline`, `kiro`, `gemini`,
`antigravity`, `qwen`, `trae`, `vscode`, `codex`, `zed`, `opencode`, `goose`, `amp`, and `generic`. Each
emits the envelope that client expects (TOML for Codex, `servers` for VS Code, `context_servers` for Zed,
`extensions` for Goose, …) and prints the destination file to stderr. The default is the `mcpServers`
object:

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

Clients with skill support can also load the four bundled skills: `node scripts/sync-agent-skills.mjs
--dest ../my-android-app` writes them to `.agents/skills/`; add `--codebuddy` for CodeBuddy's
`.codebuddy/skills/`, `--workbuddy` for WorkBuddy's `.workbuddy/skills/`, or `--both` for the first two
(`.agents/skills` + `.codebuddy/skills`); add `--workbuddy` too to write all three (Cursor and VS Code
read `.claude/skills/` directly). Slash commands, the subagent, and the gate hook stay Claude Code only.

See [docs/mcp.md](docs/mcp.md) for the tool list, parameters, recommended call order, and the
[locally verified client matrix](docs/mcp.md#verified-locally) (OpenCode, CodeBuddy Code, Codex CLI,
and WorkBuddy; WorkBuddy needs a one-time GUI approval for the custom server).

### 3. Use the CLI

```bash
npm install && npm run build
npm link                       # provides the global android-ui command

android-ui devices       # connected devices
android-ui state         # screen, foreground app, pid
android-ui dump          # capture the current UI (auto source)
android-ui find "开拍"   # search by text
android-ui view          # write an interactive HTML viewer and open it in the browser
```

See [docs/cli.md](docs/cli.md) for the full command table, analysis rules, screenshots, and coordinate mapping.

### Your first task

Put the target app on the page you care about, then just say in Claude Code:

> Locate the **Me** button on the current screen and trace it to its related code logic.

Or run the command:

```text
/android-ui:locate Me
```

The tools confirm the foreground app → capture the UI tree → lock onto the target node → scan the repository for `file:line` candidates → read the code and report the location. After a UI change, use `/android-ui:verify` to compare before/after.

To analyze a whole screen, dialog, or bottom sheet instead of one control, say "分析当前界面的代码和业务逻辑" or run `/android-ui:analyze-screen`: it maps the screen's sections to source, then follows the ViewModel, data sources, navigation, and side effects.

**Android projects only.** Activation is gated on an Android project (`settings.gradle(.kts)`, `gradlew`, a module applying `com.android.*`, or `AndroidManifest.xml`). In a non-Android repository the plugin activates only when you explicitly ask to inspect the device screen/page or explicitly mention Android; a connected device does not make the repository Android. A `PreToolUse` hook enforces the same gate for `get_state`, `dump_ui`, `find_elements`, `locate_code`, and `open_viewer`. Hooks load at session start, so restart Claude Code after installing or updating the plugin.

## What you can do

| Task                                                                      | Entry point                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Locate the Compose/XML source and business chain of a control             | `/android-ui:locate` / `locate_code`            |
| Analyze the code, state, data flow, and business logic of the current screen/dialog | `/android-ui:analyze-screen` / `analyze-screen-logic` skill |
| Understand the current screen (foreground app, Activity, visible entries) | `/android-ui:screen` / `get_state` + `dump_ui`  |
| Inspect a visible control's bounds, center, clickable/enabled state, and class | `inspect-current-screen` skill / `find_elements` + `hit_test` |
| Verify a UI change on a real device (diff + rules + screenshot)           | `/android-ui:verify` / `diff_ui` + `analyze_ui` |
| Find elements / hit-test / tap, swipe, input                              | `find_elements` / `hit_test` / `tap`, `swipe`, `input_text`, `press_key` |
| Screenshots (SVG node overlay, image→device coordinates)                  | `screenshot` / `android-ui shot`                        |
| Visualize the current screen in a browser (explicit request only)         | `open_viewer` / `android-ui view` / `/android-ui:view` |
| Layout and accessibility checks                                           | `analyze_ui` / `android-ui analyze`                     |
| Before/after layout diff around a code change                             | `diff_ui` / `android-ui diff`                           |

## Data sources at a glance

| Source      | Requires                                   | Best for                                                                |
| ----------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| `view`      | Debuggable app                             | Full View classes, resource ids, layout params, visibility              |
| `semantics` | Nothing                                    | Compose text, content descriptions, clickable bounds on any app         |
| `compose`   | Debuggable app + Android Studio + Java 17+ | Composable names, `file:line`, bounds, parameters, recomposition counts |

`auto` (the default) captures `view` + `semantics` and picks per screen: `view` for XML, `semantics` for Compose, both for mixed screens. Use `--source compose` explicitly when you need Composable-level detail (~8–12s). See [docs/data-sources.md](docs/data-sources.md).

## Documentation

| Document                                     | Content                                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [docs/data-sources.md](docs/data-sources.md) | The three data sources, `auto` selection policy, Compose JVMTI details                                   |
| [docs/cli.md](docs/cli.md)                   | CLI installation, command table, limits and defaults, analysis rules, screenshots & coordinate mapping, environment variables |
| [docs/mcp.md](docs/mcp.md)                   | MCP server configuration, tool table, limits and defaults, recommended call order                        |
| [docs/plugin.md](docs/plugin.md)             | Claude Code plugin components, installation, workflow, release & versioning                              |
| [docs/development.md](docs/development.md)   | Development, testing, and implementation notes                                                           |

## Limitations

- `view` / `compose` require `android:debuggable=true`; release builds can only use `semantics`.
- JDWP usually allows one debugger at a time; attach may fail while Android Studio is debugging.
- `compose` additionally needs a local Android Studio and Java 17+; each capture takes about 8–12s.
- `input text` reliably supports ASCII only; every command captures a fresh snapshot — there is no live monitoring.
- Text output is trimmed at 2000 nodes (`--max-nodes`/`--depth`/`--visible-only` shape the text tree only); `--json`/`--out` write the complete dump, and MCP `dump_ui` caps JSON at 800 nodes unless you raise `maxNodes`.
- The HTML viewer embeds at most 8 MB; beyond that it drops View properties, then halves the node budget down to 200, and reports `truncated`.
- `find`/`hit`/`tap` selectors only match visible nodes; image-coordinate taps require the screenshot metadata (`--image-*` or `imageX/Y/Width/Height`). MCP `screenshot` defaults to 720 px wide, while CLI `shot` keeps the native resolution.
- Content drawn directly to a `Canvas` (custom views, `SurfaceView`, `WebView` pixels) has no text or child nodes; the semantics tree only shows what the app exposes to accessibility.
- Activation targets Android projects; in other repositories it requires an explicit device/screen request or an explicit Android mention.

See [docs/data-sources.md](docs/data-sources.md) for the full boundaries of each source.

## Development

```bash
npm test          # fixture-based unit tests, no device required
npm run typecheck
npm run build     # regenerates dist/ (committed with source changes)
```

See [docs/development.md](docs/development.md).

## Attribution

- Protocol and hit-testing algorithm follow [CoXier/LayoutInspectorV2-Pro](https://github.com/CoXier/LayoutInspectorV2-Pro) (Apache-2.0).
- The ViewDebug / DDM protocol comes from AOSP `android.view.ViewDebug`, `DdmHandleViewDebug`, and ddmlib.
- The Compose tree reuses the transport/JVMTI agent and `androidx.compose.ui:ui-inspection` from a locally installed Android Studio; the protocol comes from AOSP `tools/base` (`transport` / `app-inspection` / `dynamic-layout-inspector`) and AndroidX `compose/ui/ui-inspection` (all Apache-2.0). This project does not redistribute these binaries; they are read at runtime from the user's Android Studio installation.
- The code in this project is an independent implementation released under the MIT License; see `NOTICE`.
