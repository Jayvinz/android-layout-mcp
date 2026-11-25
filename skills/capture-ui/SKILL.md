---
name: capture-ui
description: >-
  Android-only. Use when the user wants to see what is on the current Android screen or in one named block of it: the structure, the Activity/Compose surface behind it, a visible element's bounds, or a saved snapshot for later. Triggers include "查看整个屏幕", "抓取当前页面布局", "抓取这块区域", "当前界面有什么", "这个页面是什么", "现在前台是哪个 app", "看下当前“登录”按钮", "这个控件多大/在哪", "屏幕坐标 300,800 是什么", "导出布局树", "summarize the current screen", "capture this screen or block". Owns: UI facts — structure, entry points, coordinates, and the capture artifacts. Not: property values (inspect-view-attribute), source code (trace-view-wiring), defect judgments (audit-ui). Only in Android projects; in a non-Android repository use only when the user explicitly asks for the device screen or mentions Android.
---

# Capturing the Current Screen

Answer "what is on screen" from captured evidence, and hand back a snapshot the user can keep. Core principle: **capture once, describe what is there, never infer what is not.**

**The default target is the current screen. A block becomes the target only when the user names one** ("这块", "这个卡片", "顶部这一栏", "this list"). When they do, scope the report to that block instead of dumping the whole screen — a named block is a request for a smaller answer, not a preamble.

## Scope

| The user asks | Go to |
|---|---|
| Is there a layout defect (overlap, clipping, deep nesting) | `audit-ui` |
| What are this View's margins / padding / text size | `inspect-view-attribute` |
| Where is this element implemented | `trace-view-wiring` |

This skill reports facts. It does not judge quality and does not read the repository.

## Step 0 — Android project gate

Look for an Android project in the cwd or any parent: `settings.gradle(.kts)`, `gradlew(.bat)`, a module `build.gradle(.kts)` applying `com.android.*`, or `AndroidManifest.xml`. Skip `node_modules/`, `build/`, `.gradle/`.

| Workspace | User asked about | Allowed |
|---|---|---|
| Android project | anything | everything |
| Not Android | a device screen/page, or mentioned Android | observation only — no `locate_code` |
| Not Android | anything else | **no tool at all** |

**HARD STOP** on the third row: call nothing, reply in one sentence that this workspace is not an Android project, then offer device observation or ask for the Android module path. A bare "这个按钮/这个页面/这个弹窗" is not an explicit device request, and a connected device does not make the repository Android.

## Workflow

### Step 1 — Context

Call `get_state`. Record the device serial, screen size/density, foreground `package`, `activity`, pid, and `windows`.

Two facts here are worth stating explicitly, because they are the "big dimensions" of the screen:

- **`activity`** — the owning Activity. This is the single most useful identifier for the user and the anchor for any follow-up.
- **`uiKind`** — `xml`, `compose`, `mixed`, or `unknown`, from the capture in Step 2. Say which one; a Compose surface and an XML surface fail differently.

### Step 1.5 — Scope the block (only when one is named)

When the user names a block, resolve it before describing structure:

1. `find_elements` by text/id/class, or `hit_test` for a point, to get the block's node.
2. Take that node's subtree as the capture boundary; report the block's own bounds and the `activity`/`uiKind` it sits in.
3. List only the entry points inside it, and mark the parent chain above it in one line so the user knows where the block sits.
4. Save artifacts for the **whole screen** (a block has no standalone snapshot), but say the report is scoped to the block. The `savePath` files still contain everything, so `--depth`/`maxNodes` should be set for the block, not the screen.

If the named block does not exist in the capture, say so and offer the nearest matching blocks by text — do not silently fall back to the whole screen.

### Step 2 — Structure

Call `dump_ui(source="auto", format="tree", visibleOnly=true)`.

- For a Compose screen, add `dump_ui(source="compose", maxNodes=2000)` only when the user asks for Composable names or `file:line`; it takes 8–12s and may fail.
- On a non-debuggable app, `--source view` is unavailable. Use `source="dumpsys"` to get real View classes and resource ids without a debug build; it carries no text, so text comes from the semantics tree that the same capture merges in.

Summarize the top 2–3 levels, then the visible leaf labels and clickable entries. Never paste hundreds of lines.

### Step 3 — Answer a specific element

Search in this order: `find_elements(by="text")` → `by="desc"` → `by="id"` → `by="class"`. For a positional question ("屏幕坐标 300,800 是什么"), call `hit_test(x, y)` and use `index` to cycle overlapping candidates.

Report `bounds`, `center`, `clickable`, `enabled`, `className`. If several matches stay plausible, list them with bounds instead of picking one.

If nothing matches, the element may be offscreen, in another window, or labeled only by description. Check `windows`, retry with `by="desc"`, and say it is not in this capture rather than claiming it does not exist.

### Step 4 — Artifacts

When the user wants something to keep, save all three:

```text
dump_ui(source="auto", savePath=".alm/capture.json", format="json")
screenshot(savePath=".alm/capture.png")
```

- **JSON** — the full untrimmed tree, for an agent or `jq` later.
- **PNG** — the pixels, for a human.
- **XML** — `adb shell uiautomator dump /sdcard/alm.xml && adb pull /sdcard/alm.xml .alm/capture.xml`. Standard uiautomator XML opens in any browser or editor, which JSON and `.li` do not.

Android Studio's Layout Inspector cannot open these files. Its `.li` snapshot is an undocumented private format; there is no conversion, and no claim of one should be made. If the user wants AS's 3D view, that is AS's own inspector on a debuggable build, not this tool.

Report the absolute path of every file written. `.alm/` holds device serials and screen text — remind the user not to commit it.

## Output

Answer in the user's language:

```markdown
## Screen
- Package / Activity: <package> / <activity>
- uiKind: <xml|compose|mixed|unknown>, captured at <time>
- Device: <serial>, <width>x<height> @ <density>dpi

## Structure
- <top-level section> — <short description>

## Visible entry points
- <label> — id=<id>, bounds=<x,y,w,h>, center=<x,y>, clickable=<yes|no>

## Asked element
- <label>: bounds=<...>, center=<...>, clickable=<...>, enabled=<...>, class=<...>

## Artifacts
- <absolute paths, or "not saved">

## Uncertainties
- <offscreen / duplicate / dynamic / non-debuggable>
```

## Quality rules

- Never state text color, font size, or font family from the normalized tree; those live in `inspect-view-attribute`. Only raw `view.properties` may contain them, and then say they are raw values.
- Do not claim an element is enabled from appearance alone; read `enabled` from `find_elements` / `hit_test`.
- Refs (`v*` / `s*` / `d*` / `c*`) are valid for one capture only.
- Do not describe an element that is not in the capture.
- This skill never modifies code.
- MCP unavailable: `ALM_ROOT` is the plugin root (the directory holding `dist/`, `scripts/`, `skills/`). Run `node "$ALM_ROOT/dist/cli.js" dump --json --out .alm/capture.json`; if `dist/` is missing, report the build requirement and stop rather than fabricating a screen.
- No device: run `list_devices`, then point at `adb devices` / `ANDROID_SERIAL`. Do not retry in a loop.