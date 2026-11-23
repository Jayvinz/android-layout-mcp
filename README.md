# layout-inspector-android

|                      |                      |
| -------------------- | -------------------- |
| [English](README.md) | [简体中文](README.zh.md) |

![npm version](https://img.shields.io/npm/v/layout-inspector-android.svg)

![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)



![Node.js ≥ 20](https://img.shields.io/badge/node-%E2%89%A520-green.svg)

![CI](https://github.com/Jayvinz/layout-inspector-android/actions/workflows/validate.yml/badge.svg)

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

## Architecture

```
CLI (layout-inspector) ──┐
                         ├── core ──┬── JDWP + DDM → ViewDebug v2 view tree
MCP Server ──────────────┘          ├── adb uiautomator → semantics tree
                                    └── Android Studio transport + JVMTI → Compose tree
```

## Quick start

### Prerequisites

- Node.js ≥ 20 (required by the plugin / MCP / CLI)
- Android platform-tools: `adb` on `PATH`, or set `DLI_ADB` / `ADB_PATH`
- A device or emulator with USB debugging enabled; the target app running in the foreground
- The `view` / `compose` sources require a debuggable build (`android:debuggable=true`); `semantics` has no such requirement
- For the Claude Code plugin, Claude Code must be able to invoke `node` / `npm` from `PATH`

### 1. Install the Claude Code plugin (recommended)

```text
/plugin marketplace add Jayvinz/layout-inspector-android
/plugin install layout-inspector-android@jayvinz-tools
```

After installation you get:

| Component                             | Content                                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| MCP server `layout-inspector-android` | `dump_ui`, `find_elements`, `locate_code`, `hit_test`, `analyze_ui`, `screenshot`, `open_viewer`, `diff_ui`, `tap`, and more    |
| Slash commands                        | `/layout-inspector-android:locate` (UI→source), `:screen` (current screen), `:view` (browser viewer), `:verify` (verify changes on device) |
| Skills                                | `inspect-current-screen`, `locate-ui-code`, `verify-ui-change`                                                   |
| Read-only subagent                    | `ui-code-locator`                                                                                                |

Use `/mcp` to confirm the server is loaded; `/help` lists the commands above.

**Local development/debugging**: run `npm install && npm run build` in the repository root first, then point the marketplace at your local path:

```text
/plugin marketplace add E:/repo/layout-inspector-android
/plugin install layout-inspector-android@jayvinz-tools
```

See [docs/plugin.md](docs/plugin.md) for the component list, publishing, and versioning.

### 2. Connect the MCP server (other clients)

```bash
node dist/cli.js mcp --print-config
```

Put the printed config into your client's MCP configuration (for example `.mcp.json` at the Claude Code project root):

```json
{
  "mcpServers": {
    "layout-inspector-android": {
      "command": "node",
      "args": ["E:/repo/layout-inspector-android/dist/mcp.js"]
    }
  }
}
```

See [docs/mcp.md](docs/mcp.md) for the tool list, parameters, and the recommended call order.

### 3. Use the CLI

```bash
npm install && npm run build
npm link                       # provides the global layout-inspector command

layout-inspector devices       # connected devices
layout-inspector state         # screen, foreground app, pid
layout-inspector dump          # capture the current UI (auto source)
layout-inspector find "开拍"   # search by text
layout-inspector view          # write an interactive HTML viewer and open it in the browser
```

See [docs/cli.md](docs/cli.md) for the full command table, analysis rules, screenshots, and coordinate mapping.

### Your first task

Put the target app on the page you care about, then just say in Claude Code:

> Locate the **Me** button on the current screen and trace it to its related code logic.

Or run the command:

```text
/layout-inspector-android:locate Me
```

The tools confirm the foreground app → capture the UI tree → lock onto the target node → scan the repository for `file:line` candidates → read the code and report the location. After a UI change, use `/layout-inspector-android:verify` to compare before/after.

## What you can do

| Task                                                                      | Entry point                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Locate the Compose/XML source and business chain of a control             | `/layout-inspector-android:locate` / `locate_code`            |
| Understand the current screen (foreground app, Activity, visible entries) | `/layout-inspector-android:screen` / `get_state` + `dump_ui`  |
| Inspect a visible control's bounds, center, clickable/enabled state, and class | `inspect-current-screen` skill / `find_elements` + `hit_test` |
| Verify a UI change on a real device (diff + rules + screenshot)           | `/layout-inspector-android:verify` / `diff_ui` + `analyze_ui` |
| Find elements / hit-test / tap, swipe, input                              | `find_elements` / `hit_test` / `tap`, `swipe`, `input_text`   |
| Screenshots (SVG node overlay, image→device coordinates)                  | `screenshot` / `layout-inspector shot`                        |
| Visualize the current screen in a browser (explicit request only)         | `open_viewer` / `layout-inspector view` / `/layout-inspector-android:view` |
| Layout and accessibility checks                                           | `analyze_ui` / `layout-inspector analyze`                     |
| Before/after layout diff around a code change                             | `diff_ui` / `layout-inspector diff`                           |

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
| [docs/cli.md](docs/cli.md)                   | CLI installation, command table, analysis rules, screenshots & coordinate mapping, environment variables |
| [docs/mcp.md](docs/mcp.md)                   | MCP server configuration, tool table, recommended call order                                             |
| [docs/plugin.md](docs/plugin.md)             | Claude Code plugin components, installation, workflow, release & versioning                              |
| [docs/development.md](docs/development.md)   | Development, testing, and implementation notes                                                           |

## Limitations

- `view` / `compose` require `android:debuggable=true`; release builds can only use `semantics`.
- JDWP usually allows one debugger at a time; attach may fail while Android Studio is debugging.
- `compose` additionally needs a local Android Studio and Java 17+; each capture takes about 8–12s.
- `input text` reliably supports ASCII only; every command captures a fresh snapshot — there is no live monitoring.

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
