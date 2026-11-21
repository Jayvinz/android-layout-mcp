# CLI reference

[English](cli.md) | [简体中文](cli.zh.md)

The `layout-inspector` CLI drives the same core as the MCP server. Requirements: Node.js ≥ 20 and Android platform-tools (`adb` on `PATH`, or set `DLI_ADB` / `ADB_PATH`).

## Installation

```bash
npm install
npm run build

# Option 1: run directly
node dist/cli.js devices

# Option 2: link a global command
npm link
layout-inspector devices
```

You can also run from source without building: `npx tsx src/cli.ts dump`.

## Quick start

```bash
# Devices and foreground app
layout-inspector devices
layout-inspector state

# Current screen (auto by default; Compose goes to semantics)
layout-inspector dump

# Pick a source and depth; JSON output can go straight to an agent
layout-inspector dump --source view --depth 8 --props
layout-inspector dump --source both --json --out ui.json

# Search by text / id / class / ref
layout-inspector find "开拍" --both
layout-inspector find "com.example:id/submit" --by id
layout-inspector find "Button" --by class --match exact --clickable

# Hit test by screen coordinates (smallest area first; --index to switch when overlapping)
layout-inspector hit 540 2239 --both

# Screenshot (downscalable) with an SVG node overlay
layout-inspector shot --out screenshot.png --annotate
layout-inspector shot --out small.png --max-width 540
layout-inspector shot --out small.png --scale 0.5

# Layout / accessibility checks
layout-inspector analyze

# Tap the center of an element (locates first, then taps)
layout-inspector tap --text "关注"
layout-inspector tap 540 2239

# Two-snapshot diff: before/after a code change or page switch
layout-inspector dump --json --out before.json
# ... modify, rerun, refresh the page ...
layout-inspector dump --json --out after.json
layout-inspector diff before.json after.json

# Full properties of a single node
layout-inspector inspect v4
layout-inspector inspect 0.0.0
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
| `layout-inspector devices` | List devices, models, Android/SDK versions |
| `layout-inspector state` | Device, screen, foreground app, pid, ViewRootImpl windows |
| `layout-inspector windows` | List JDWP windows only (popups/dialogs included) |
| `layout-inspector dump` | Capture UI: `--source auto/view/semantics/compose/both`, `--depth`, `--props`, `--json`, `--out` |
| `layout-inspector find <query>` | `--by any/text/desc/id/class/ref`, `--match contains/exact/regex`, `--clickable`, `--both` |
| `layout-inspector hit <x> <y>` | Hit test; returns all candidates at the coordinate, smallest visible area first |
| `layout-inspector inspect <ref>` | Full JSON of a single node (including View properties) |
| `layout-inspector analyze` | Layout/accessibility checks, see the table below |
| `layout-inspector shot` | Screenshot; `--max-width` / `--scale` downscale; `--annotate` generates `*.annotated.svg` |
| `layout-inspector diff <a> <b>` | Compare two dump JSON files |
| `layout-inspector tap` | Tap a device coordinate, map a screenshot coordinate via `--image-*`, or select by `--text/--id/--ref` and tap the center |
| `layout-inspector swipe` / `input` / `key` | Swipe, input ASCII text, send keyevent |
| `layout-inspector studio` | Show the Android Studio used for Compose inspection: path, source (explicit/env/default/process), JBR Java |
| `layout-inspector mcp` | Start the MCP server (stdio); `--print-config` prints a client config |
| `layout-inspector compose-clean` | Stop the resident transport daemon, clean `/data/local/tmp/dli-compose` and the inspector jar in app code_cache |

Global options: `-s, --serial`, `--adb <path>`, `--timeout <ms>`, `-v, --verbose`.
Compose JVMTI options: `--studio <path>`, `--java <path>`, `--compose-version <v>`.
Screenshot fallback: on capture failure a `dli-fallback-<time>.png` (720px wide by default) is saved automatically; disable with `--no-fallback-screenshot`. With multiple devices `ANDROID_SERIAL` also works.

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
| `deep_nesting` | Nesting deeper than the threshold (default 14) |

Enable only the rules you need: `layout-inspector analyze --rules small_touch_target,overlap`.

## Screenshots and fallback

```bash
layout-inspector shot --out screenshot.png                  # original resolution
layout-inspector shot --out small.png --max-width 540       # 540x1200, about 180KB
layout-inspector shot --out small.png --scale 0.5
layout-inspector shot --out ui.png --annotate --source compose
```

- Screenshots always use `adb exec-out screencap -p`, optionally downscaled with pure JS (`pngjs`) box filtering; no ImageMagick/Sharp required.
- **Automatic fallback on structured capture failure**: `dump`/`find`/`hit`/`analyze` and friends also save a `dli-fallback-<time>.png` and give the path in the error message; MCP tools return the screenshot as image content alongside the error text. Disable with `--no-fallback-screenshot` or `DLI_NO_FALLBACK_SCREENSHOT=1`.
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
layout-inspector tap --image-x 360 --image-y 800 --image-width 720 --image-height 1600
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
| `DLI_ADB` / `ADB_PATH` / `--adb` | Path to `adb` |
| `ANDROID_SERIAL` / `--serial` | Target device when several are connected |
| `DLI_ANDROID_STUDIO` / `--studio` | Android Studio installation (Compose inspection) |
| `DLI_JAVA` / `--java` | Java used by the Compose helper |
| `DLI_COMPOSE_VERSION` | The app's Compose version (default 1.8.3) |
| `DLI_COMPOSE_INSPECTOR_JAR` | Explicit `inspector.jar` |
| `DLI_COMPOSE_HELPER_JAR` | Precompiled JVMTI helper JAR |
| `DLI_NO_FALLBACK_SCREENSHOT=1` | Disable the fallback screenshot on capture failure |
