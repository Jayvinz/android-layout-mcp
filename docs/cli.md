# CLI reference

[English](cli.md) | [简体中文](cli.zh.md)

The `android-layout` CLI drives the same core as the MCP server. Requirements: Node.js ≥ 20 and Android platform-tools (`adb` on `PATH`, or set `AUI_ADB` / `ADB_PATH`).

## Installation

```bash
npm install
npm run build

# Option 1: run directly
node dist/cli.js devices

# Option 2: link a global command
npm link
android-layout devices
```

You can also run from source without building: `npx tsx src/cli.ts dump`.

## Quick start

```bash
# Devices and foreground app
android-layout devices
android-layout state

# Current screen (auto by default; Compose goes to semantics)
android-layout dump

# Pick a source and depth; JSON output can go straight to an agent
android-layout dump --source view --depth 8 --props
android-layout dump --source both --json --out ui.json

# Search by text / id / class / ref
android-layout find "开拍" --both
android-layout find "com.example:id/submit" --by id
android-layout find "Button" --by class --match exact --clickable

# Hit test by screen coordinates (smallest area first; --index to switch when overlapping)
android-layout hit 540 2239 --both

# Screenshot (downscalable) with an SVG node overlay
android-layout shot --out screenshot.png --annotate
android-layout shot --out small.png --max-width 540
android-layout shot --out small.png --scale 0.5

# Layout / accessibility checks
android-layout analyze


# Hit-test a device coordinate (all overlapping nodes, smallest first)
android-layout hit 540 2239 --json



# Full properties of a single node
android-layout inspect v4
android-layout inspect 0.0.0
```

Example of `dump` human-readable output:

```
device <serial> (Pixel 7)  android 13 (sdk 33)
screen 1080x2400 @ 440dpi (2.75x) portrait
target com.example.droidreel.debug pid=9597 activity=...CommunityActivity debuggable
view window: com.example.droidreel.debug/.../android.view.ViewRootImpl@60b9a5d (100ms)

v0 DecorView [0,0][1080,2400] 1080x2400 @(540,1200)
  v1 FrameLayout [0,0][1080,2400] 1080x2400 @(540,1200)
    v2 FrameLayout id/content [0,0][1080,2400] 1080x2400 @(540,1200)
      v3 ComposeView [0,0][1080,2400] 1080x2400 @(540,1200)
```

## Commands

| Command | Description |
|---|---|
| `android-layout devices` | List devices, models, Android/SDK versions; `--json` |
| `android-layout state` | Device, screen, foreground app, pid, ViewRootImpl windows; `--package` targets a specific app, `--json` |
| `android-layout windows` | List JDWP windows only (popups/dialogs included); `--package`, `--pid`, `--json`. Kept on purpose: `--pid` targets any process, not just the foreground app, so it is not a duplicate of `state` |
| `android-layout dump` | Capture UI: `--source auto/view/semantics/dumpsys/compose/both`, `--depth`, `--max-nodes` (text, default 2000), `--visible-only`, `--props`, `--package`, `--pid`, `--window` (view source), `--json`, `--out` |
| `android-layout find <query>` | `--by any/text/desc/id/class/ref`, `--match contains/exact/regex`, `--clickable`, `--both`, `--source auto/view/semantics/dumpsys/compose/both`, `--limit` (default 50), `--json` |
| `android-layout hit <x> <y>` | Hit test; returns all candidates at the coordinate, smallest visible area first; `--source auto/view/semantics/dumpsys/compose/both`, `--index` (default 0), `--json` |
| `android-layout inspect <ref>` | Full JSON of a single node (including View properties); `--source auto/view/semantics/dumpsys/compose/both`, `--json` |
| `android-layout analyze` | Layout/accessibility checks; `--source auto/view/semantics/dumpsys/compose/both`, `--rules`, `--min-touch-dp` (48), `--max-depth` (14), `--no-props`, `--paths`, `--json` |
| `android-layout shot` | Screenshot; `--max-width` / `--scale` downscale; `--annotate` generates `*.annotated.svg` from `--source auto/view/semantics/dumpsys/compose/both`; `--json`, `--json --base64` |
| `android-layout fragments` | Activity/Fragment structure from `dumpsys`; `--package`, `--json`, `--all` (keep AndroidX bookkeeping fragments) |
| `android-layout studio` | Show the Android Studio used for Compose inspection: path, source (explicit/env/default/process), JBR Java; `--json` |
| `android-layout mcp` | Start the MCP server (stdio); `--print-config [--client <id>]` prints a config shaped for Claude Code, Codex, VS Code, Zed, or another client ([list](mcp.md#other-clients)), `--register-view-attributes` enables the global `debug_view_attributes` setting (restarts the app) first |
| `android-layout compose-clean` | Stop the resident transport daemon, clean `/data/local/tmp/aui-compose` and the inspector jar in app code_cache; `--package` targets a specific app |

Every command that reads a tree takes the same `--source` values (`auto`, `view`, `semantics`, `dumpsys`, `compose`, `both`); `auto` is the default everywhere.

Global options: `-s, --serial`, `--adb <path>`, `--timeout <ms>`, `-v, --verbose`.
Compose JVMTI options: `--studio <path>`, `--java <path>`, `--compose-version <v>`.
Screenshot fallback: on capture failure an `aui-fallback-<time>.png` (720px wide by default) is saved automatically; disable with `--no-fallback-screenshot`. With multiple devices `ANDROID_SERIAL` also works.

## Limits and defaults

- **Text tree vs JSON**: `--depth`, `--max-nodes` (default 2000) and `--visible-only` shape only the human-readable tree; when it is cut, the last line says how many nodes were shown. `--json` / `--out` write the complete dump (`version: 1`, no trimming), so an agent should trim on its side or use MCP `dump_ui` with `depth`/`maxNodes`.
- **Search**: `find` and `hit` selectors ignore invisible/gone nodes. `contains` is case-insensitive, `exact` is case-sensitive, and `--match regex` (or a `/pattern/flags` query, default flag `i`) is real regex — an invalid pattern fails the command. `--by class` tests both the fully-qualified and the short class name. `find` merges matches from every searched tree and returns at most `--limit` (default 50); `hit` sorts candidates by visible area and `--index` picks among them.
- **Screenshots**: CLI `shot` keeps the native resolution unless `--max-width`/`--scale` is given; `--base64` adds data only together with `--json`. MCP `screenshot` defaults to 720px wide.
- **Before/after**: there is no `diff` subcommand. Save a dump before and after a change (`dump --json --out .aui/before.json`, then `.aui/after.json`) and compare the two files yourself; refs are per capture, so match on source, resource id, class, text, and path. Then run `analyze` on the new capture.
- **Analyze**: `deep_nesting` is skipped for the `compose` source, unknown rule names are ignored, and `small_touch_target` skips bottom-clipped accessibility nodes on ROMs that under-report the window (e.g. MIUI).
- **Analyze reads one tree**: the one that matches the screen — View for an XML screen, semantics for a Compose screen, dumpsys for `--source dumpsys`, Compose for `--source compose`. A `mixed` screen is the exception: View and Compose regions are disjoint, so both trees are scanned. This keeps a defect from being reported once per captured tree — a `--source dumpsys` capture always carries a semantics tree too, merged in only to supply text. `overdraw` and `rtl_issues` always read the View tree when it was captured, because only it carries the raw property map.
- **Fallbacks**: with `auto`, a tree that fails to capture is skipped with a warning and the other tree is used; when the target package is not running, view capture is skipped. Warnings surface in the text tree, in JSON (`warnings`), and on stderr for `analyze`. `--window` takes a 0-based index or a name substring and applies to the view source only.
- **`mcp --register-view-attributes`**: writes the global `debug_view_attributes 1` setting (which restarts the app) before starting the server; it enriches ViewDebug properties but is not required for normal use.

## Analysis rules

| rule | Description |
|---|---|
| `small_touch_target` | Clickable area smaller than 48dp in either dimension (configurable) |
| `overlap` | Sibling clickable elements overlap by more than 50% of the smaller one's area |
| `clipped` | More than 50% of the area clipped by an ancestor (scrollable content excluded) |
| `outside_parent` | Node extends beyond a non-scrollable parent |
| `offscreen` | Visible View entirely off screen |
| `invisible_clickable` | Not visible but still clickable |
| `zero_size` | Zero-size View / clickable semantics node |
| `unlabeled_clickable` | Clickable with no text/desc/id on itself or descendants |
| `duplicate_id` | The same resource-id on multiple visible nodes |
| `deep_nesting` | Nesting deeper than the threshold (default 14); skipped for the `compose` source |
| `overdraw` | A child paints a different opaque background over its parent across the same area |
| `rtl_issues` | A hardcoded `leftMargin`/`rightMargin` with no `startMargin`/`endMargin` counterpart, so it will not mirror in RTL |

Enable only the rules you need: `android-layout analyze --rules small_touch_target,overlap`.

`overdraw` and `rtl_issues` read the raw View property map, so `analyze` requests properties by default. Pass `--no-props` to skip them; the JSON then lists them under `skipped` instead of reporting a clean screen.

## Screenshots and fallback

```bash
android-layout shot --out screenshot.png                  # original resolution
android-layout shot --out small.png --max-width 540       # 540x1200, about 180KB
android-layout shot --out small.png --scale 0.5
android-layout shot --out ui.png --annotate --source compose
```

- Screenshots always use `adb exec-out screencap -p`, optionally downscaled with pure JS (`pngjs`) box filtering; no ImageMagick/Sharp required.
- **Automatic fallback on structured capture failure**: `dump`/`find`/`hit`/`analyze` and friends also save an `aui-fallback-<time>.png` and give the path in the error message; MCP tools return the screenshot as image content alongside the error text. Disable with `--no-fallback-screenshot` or `AUI_NO_FALLBACK_SCREENSHOT=1`.
- MCP `screenshot` defaults to 720px wide to keep the payload small; pass `fullResolution=true` for native resolution.
- The SVG from `--annotate` maps node boxes by the screenshot scale factor automatically.

### Image coordinates ≠ device coordinates

After downscaling, an `(x, y)` read from the image is an **image coordinate**; a device coordinate is what `hit` accepts and what you report to the user. Screenshot output (CLI `--json` and the MCP image text) always includes the original size and mapping factors:

```json
{
  "width": 720,
  "height": 1600,
  "originalWidth": 1080,
  "originalHeight": 2400,
  "screenWidth": 1080,
  "screenHeight": 2400,
  "scale": 0.6667,
  "coordinateMapping": {
    "imageToDevice": { "x": 1.5, "y": 1.5 },
    "deviceToImage": { "x": 0.6667, "y": 0.6667 },
    "formula": "deviceX = round(imageX * 1.5); deviceY = round(imageY * 1.5)"
  }
}
```

Convert before quoting a position or calling `hit`:

```bash
# (360, 800) read from a 720x1600 image maps to (540, 1200) on a 1080x2400 screen
android-layout hit 540 1200 --json
```

Coordinates returned by `find` / `hit` / MCP `find_elements` / `hit_test` are already device coordinates; `coordinateMapping` is only needed for visual/pixel-based work.

## Environment variables

| Variable | Purpose |
|---|---|
| `AUI_ADB` / `ADB_PATH` / `--adb` | Path to `adb` |
| `ANDROID_SERIAL` / `--serial` | Target device when several are connected |
| `AUI_ANDROID_STUDIO` / `ANDROID_STUDIO_PATH` / `--studio` | Android Studio installation (Compose inspection) |
| `AUI_JAVA` / `--java` | Java used by the Compose helper |
| `AUI_COMPOSE_VERSION` | The app's Compose version (default 1.8.3) |
| `AUI_COMPOSE_INSPECTOR_JAR` | Explicit `inspector.jar` |
| `AUI_COMPOSE_HELPER_JAR` | Precompiled JVMTI helper JAR |
| `AUI_NO_FALLBACK_SCREENSHOT=1` | Disable the fallback screenshot on capture failure |
| `AUI_JAVAC` / `AUI_JAR` | Compiler and jar tool used by `npm run build:helper` |
| `AUI_GATE_DEBUG=1` | Append `PreToolUse` hook decisions to `aui-android-gate.log` in the temp directory |
