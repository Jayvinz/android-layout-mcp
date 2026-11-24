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

# Interactive HTML viewer (explicit visual request; opens the browser)
android-layout view
android-layout view --no-open --out .aui/viewer.html

# Tap the center of an element (locates first, then taps)
android-layout tap --text "关注"
android-layout tap 540 2239

# Two-snapshot diff: before/after a code change or page switch
android-layout dump --json --out before.json
# ... modify, rerun, refresh the page ...
android-layout dump --json --out after.json
android-layout diff before.json after.json

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
| `android-layout state` | Device, screen, foreground app, pid, ViewRootImpl windows; `--json` |
| `android-layout windows` | List JDWP windows only (popups/dialogs included); `--package`, `--pid`, `--json` |
| `android-layout dump` | Capture UI: `--source auto/view/semantics/compose/both`, `--depth`, `--max-nodes` (text, default 2000), `--visible-only`, `--props`, `--package`, `--pid`, `--window` (view source), `--json`, `--out` |
| `android-layout find <query>` | `--by any/text/desc/id/class/ref`, `--match contains/exact/regex`, `--clickable`, `--both`, `--source`, `--limit` (default 50), `--json` |
| `android-layout hit <x> <y>` | Hit test; returns all candidates at the coordinate, smallest visible area first; `--source`, `--index` (default 0), `--json` |
| `android-layout inspect <ref>` | Full JSON of a single node (including View properties); `--source`, `--json` |
| `android-layout analyze` | Layout/accessibility checks; `--rules`, `--min-touch-dp` (48), `--max-depth` (14), `--paths`, `--json` |
| `android-layout shot` | Screenshot; `--max-width` / `--scale` downscale; `--annotate` generates `*.annotated.svg`; `--json`, `--json --base64` |
| `android-layout view` (alias `open`) | Capture once, write a self-contained interactive HTML viewer, and open it in the browser; `--no-open` writes only |
| `android-layout diff <a> <b>` | Compare two dump JSON files; `--source`, `--tolerance` (default 1 px), `--json` |
| `android-layout tap` | Tap a device coordinate, map a screenshot coordinate via `--image-*`, or select by `--text/--id/--ref` with `--by`/`--match`/`--index`/`--source` and tap the center |
| `android-layout swipe` / `input` / `key` | Swipe (`--duration`, default 300ms), input ASCII text, send keyevent |
| `android-layout studio` | Show the Android Studio used for Compose inspection: path, source (explicit/env/default/process), JBR Java; `--json` |
| `android-layout mcp` | Start the MCP server (stdio); `--print-config [--client <id>]` prints a config shaped for Claude Code, Codex, VS Code, Zed, or another client ([list](mcp.md#other-clients)), `--register-view-attributes` enables the global `debug_view_attributes` setting (restarts the app) first |
| `android-layout compose-clean` | Stop the resident transport daemon, clean `/data/local/tmp/aui-compose` and the inspector jar in app code_cache; `--package` targets a specific app |

Global options: `-s, --serial`, `--adb <path>`, `--timeout <ms>`, `-v, --verbose`.
Compose JVMTI options: `--studio <path>`, `--java <path>`, `--compose-version <v>`.
Screenshot fallback: on capture failure an `aui-fallback-<time>.png` (720px wide by default) is saved automatically; disable with `--no-fallback-screenshot`. With multiple devices `ANDROID_SERIAL` also works.

## Limits and defaults

- **Text tree vs JSON**: `--depth`, `--max-nodes` (default 2000) and `--visible-only` shape only the human-readable tree; when it is cut, the last line says how many nodes were shown. `--json` / `--out` write the complete dump (`version: 1`, no trimming), so an agent should trim on its side or use MCP `dump_ui` with `depth`/`maxNodes`.
- **Search**: `find`, `hit`, and `tap` selectors ignore invisible/gone nodes. `contains` is case-insensitive, `exact` is case-sensitive, and `--match regex` (or a `/pattern/flags` query, default flag `i`) is real regex — an invalid pattern fails the command. `--by class` tests both the fully-qualified and the short class name. `find` merges matches from every searched tree and returns at most `--limit` (default 50); `hit` sorts candidates by visible area and `--index` picks among them.
- **Tap**: a selector only matches visible nodes, and a hidden match is an error rather than a silent tap. Image-coordinate taps need all four `--image-*` flags; `--index` disambiguates overlapping matches. On a mixed screen, `tap --text` searches only the first tree of the selected source — pass `--source semantics` (or use `--ref` with `--source both`) when the label exists only in the Compose semantics tree.
- **Screenshots**: CLI `shot` keeps the native resolution unless `--max-width`/`--scale` is given; `--base64` adds data only together with `--json`. MCP `screenshot` defaults to 720px wide.
- **Viewer budget**: the embedded JSON is capped at 8 MB. On overflow the viewer first drops `--props`, then halves `--max-nodes` (floor 200); `view --json` reports `truncated`, and the embedded payload carries `limits.budgetExceeded`. The page is a static snapshot either way.
- **Diff**: compares one tree per run and keys nodes by identity, not pixels. `--tolerance` (default 1 px) ignores smaller bound changes; `--source` forces the tree when the two dumps disagree on the primary source.
- **Analyze**: `deep_nesting` is skipped for the `compose` source, unknown rule names are ignored, and `small_touch_target` skips bottom-clipped accessibility nodes on ROMs that under-report the window (e.g. MIUI).
- **Fallbacks**: with `auto`, a tree that fails to capture is skipped with a warning and the other tree is used; when the target package is not running, view capture is skipped. Warnings surface in the text tree, in JSON (`warnings`), and on stderr for `analyze`. `--window` takes a 0-based index or a name substring and applies to the view source only.
- **Input and keys**: `input` is ASCII-only (spaces are sent as `%s`); `key` is forwarded to `adb shell input keyevent` unchanged, so use `KEYCODE_*` names or numeric codes — anything else fails on the device.
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

Enable only the rules you need: `android-layout analyze --rules small_touch_target,overlap`.

## Interactive viewer

`android-layout view` (alias `open`) captures the current UI once, writes one self-contained HTML file, and opens it in the default browser. Use it only when the user explicitly asks to visualize the screen; `dump`, `find`, `analyze`, `shot`, and verification never open a browser as a side effect.

```bash
android-layout view                                    # .aui/viewer.html + browser
android-layout view --no-open                          # write the file only
android-layout view --out .tmp-view/v.html             # custom path
android-layout view --source semantics --max-width 720
android-layout view --rules small_touch_target,overlap --no-issues
android-layout view --json                             # path, opened, bytes, screenshot metadata
```

| Flag | Default | Meaning |
|---|---|---|
| `--source` | `auto` | `auto`, `view`, `semantics`, `compose`, or `both` |
| `--out` | `.aui/viewer.html` | HTML output path; parent directories are created |
| `--no-open` | off | Write the file without launching a browser |
| `--max-width` | `1080` | Downscale the embedded screenshot to at most this width |
| `--max-nodes` | `4000` | Maximum serialized nodes per tree |
| `--props` | off | Embed every ViewDebug property in node details |
| `--rules` | all | Comma-separated analysis rules |
| `--no-issues` | off | Skip layout/accessibility analysis |
| `--package`, `--pid`, `--window` | foreground app | Same target selection as `dump` |
| `--json` | off | Emit `{path, opened, browser?, openError?, bytes, uiKind, sources, truncated, screenshot}` |

The page embeds the tree, a base64 screenshot, node details, and issues; it makes no network requests and works from `file://`. It is a static snapshot: refs are valid only for that capture. The embedded JSON is capped at 8 MB — on overflow the viewer drops properties first, then halves the node budget down to 200 and sets `truncated` / `limits.budgetExceeded`. The HTML contains device serials, package names, and screen text — keep it under the gitignored `.aui/` and do not commit it. `AUI_NO_OPEN=1` disables browser launch globally.

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

After downscaling, an `(x, y)` read from the image is an **image coordinate**, while `input tap` needs a **device coordinate**. Screenshot output (CLI `--json` and the MCP image text) always includes the original size and mapping factors:

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

Prefer the **image-aware tap** to avoid manual conversion:

```bash
# (360, 800) read from a 720x1600 image
android-layout tap --image-x 360 --image-y 800 --image-width 720 --image-height 1600
# -> image (360, 800) in 720x1600 -> device (540, 1200) on 1080x2400
```

MCP:

```json
{
  "name": "tap",
  "arguments": {
    "imageX": 360,
    "imageY": 800,
    "imageWidth": 720,
    "imageHeight": 1600
  }
}
```

If the agent got device coordinates from `find_elements` / `hit_test`, pass them straight to `tap`'s `x/y`. `coordinateMapping` is only needed for visual/pixel-based work.

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
| `AUI_NO_OPEN=1` | Never launch a browser from `view` / `open_viewer` (still writes the HTML) |
| `AUI_NO_FALLBACK_SCREENSHOT=1` | Disable the fallback screenshot on capture failure |
| `AUI_JAVAC` / `AUI_JAR` | Compiler and jar tool used by `npm run build:helper` |
| `AUI_GATE_DEBUG=1` | Append `PreToolUse` hook decisions to `aui-android-gate.log` in the temp directory |
