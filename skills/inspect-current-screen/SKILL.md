---
name: inspect-current-screen
description: >-
  Android-only. Use when the user wants to look at, capture, summarize, or inspect the current Android screen or a visible control without tracing source code. Trigger on "抓取当前页面布局", "当前页面布局", "看下当前页面/界面", "当前界面有什么", "这个页面是什么", "截个图看看", "导出布局树", "打开可视化看看", "在浏览器里打开当前页面", "可视化当前布局", "open the UI viewer", "现在前台是哪个 app", "看下当前“登录”按钮", "这个控件多大/在哪/可点击吗/什么类型", "顶部那个图标是什么", "这个按钮为什么是灰的", "summarize the current screen". Also use for direct device interaction ("点一下", "滑到下面", "屏幕坐标 300,800", "输入 hello", "按返回键") and audits ("有没有小点击区域", "有没有重叠", "无障碍检查", "布局有没有问题"). Only in Android projects; in a non-Android repository use only when the user explicitly asks for the device screen/page or mentions Android. Do not use for source/implementation/state (locate-ui-code), whole-screen code/business analysis (analyze-screen-logic), before/after checks (verify-ui-change), or general Android questions without a live screen.
---

# Inspecting the Current Android Screen

Look at the live device screen and answer from captured UI evidence. Core principle: **capture device evidence first, stay read-only, and stop before source tracing.** This skill owns "what is on screen" questions; it never opens the repository or calls `locate_code`.

## Step 0 — Android project gate

Confirm the working directory (or the repo root the user named) is an Android project. Check the cwd and walk up parent directories:
`settings.gradle(.kts)`, `gradlew(.bat)`, a module `build.gradle(.kts)` applying `com.android.*`, or `AndroidManifest.xml`. Skip `node_modules/`, `build/`, and `.gradle/`.

**HARD STOP:** if no marker exists and the user did not explicitly ask to inspect a connected device screen/page and did not explicitly mention Android, do NOT call `get_state`, `dump_ui`, `find_elements`, `locate_code`, `open_viewer`, or any other tool. Reply in one sentence: this workspace is not an Android project, so source tracing is unavailable; offer to inspect a connected device screen if they want, or ask for the Android module path.

A reference like "这个按钮/这个页面/这个弹窗" alone is not an explicit device request. A connected device does not make the repository Android.

If the user explicitly asks about a connected device screen/page but no Android marker exists: observation is allowed (`get_state`/`dump_ui`/`find_elements`), but source analysis is unavailable — do not call `locate_code` until the user points at an Android module. If the user only mentions Android without an Android module present, say the module path is still needed and do not scan.


## Prerequisites

1. Confirm `adb` is available and the device is online: MCP `list_devices`, or `adb devices`. With multiple devices, pick a `serial` and pass the same one to every call.
2. The target app should be in the foreground. Record `package` and `activity` from `get_state`; if the user names an app that is not in the foreground, say so before summarizing.
3. MCP tools come from the `android-ui` server. This skill uses `list_devices`, `get_state`, `dump_ui`, `find_elements`, `hit_test`, `screenshot`, `analyze_ui`, `tap`, `swipe`, `input_text`, and `press_key`.
4. If MCP is unavailable, fall back to the CLI, where `AUI_ROOT` is the plugin root (the directory that contains `dist/`, `scripts/`, and `skills/`): `${CLAUDE_PLUGIN_ROOT}` in Claude Code, otherwise your plugin checkout. `android-ui` on `PATH` is equivalent:
   ```bash
   mkdir -p .aui
   node "$AUI_ROOT/dist/cli.js" state --json
   node "$AUI_ROOT/dist/cli.js" dump --json --out .aui/current.json
   node "$AUI_ROOT/dist/cli.js" find "登录" --json
   ```
   If `dist/` does not exist, the plugin has not been built. Tell the user to run `npm install && npm run build` in the plugin directory; do not fabricate a screen.

## Workflow

### Step 1 — Device and app context

Call `get_state`. Record the device serial/model, screen size/density, foreground `package`, `activity`, pid, and windows. Every later claim is anchored to this page context.

### Step 2 — Capture the visible tree

Call `dump_ui(source="auto", format="tree", visibleOnly=true)`. Record `uiKind` (`xml` / `compose` / `mixed` / `unknown`) and the visible hierarchy.

- Do not paste hundreds of lines. Summarize the top 2-3 levels, then the visible leaf labels and clickable entries.
- Refs (`v*` / `s*` / `c*`) are valid only for this capture; re-capture after the screen changes.
- For an export request ("导出布局树", "save the dump"), pass `savePath=".aui/current.json"` and report the path. Never commit dumps.

### Step 3 — Answer about a specific control

When the user points at a control ("看下当前“登录”按钮", "顶部那个图标是什么"), search in this priority:

1. `find_elements(query="<text>", by="text")`
2. `by="desc"` for icon buttons and accessibility labels
3. `by="id"` for resource ids shown in the tree
4. `by="class"` for a View or Compose class name

Report `bounds`, `center`, `clickable`, `enabled`, and `className` for the winning node. When the reference is positional ("屏幕坐标 300,800 是什么", "the thing under this point"), call `hit_test(x, y)` and use `index` to cycle through overlapping candidates. If several matches remain plausible, list them with bounds instead of picking one.

If nothing matches, the control may be offscreen, in another window, or labeled only by description. Check `windows` from `get_state`, retry with `by="desc"`, and scroll only if the user asked about that area.

### Step 4 — Interact once, only when asked

Direct device actions are one-shot; do not turn them into a test loop:

- `tap(text="...")` or `tap(ref="...")`; prefer a selector over blind coordinates.
- `swipe(x1, y1, x2, y2)` for a scroll gesture. There is no semantic "scroll until visible" helper, so compute coordinates from `screen` or a screenshot.
- `input_text(text)` types ASCII only; do not promise Chinese input.
- `press_key(key="KEYCODE_BACK")` and other key events.
- For screenshot coordinates, map image pixels to device coordinates with the returned `coordinateMapping.imageToDevice`, or use `tap(imageX=..., imageY=..., imageWidth=..., imageHeight=...)`. Never tap raw image pixels.
- After an action, re-run `get_state` or `dump_ui` before making claims about the new screen; old refs are invalid.

### Step 5 — Layout and accessibility questions

When the user asks "有没有小点击区域", "有没有重叠", "无障碍检查", or "布局有没有问题", call `analyze_ui(source="auto")`. Report the rule, the node path/ref, bounds, and the offending value. Relevant rules include `small_touch_target`, `overlap`, `clipped`, `outside_parent`, `invisible_clickable`, and `unlabeled_clickable`. Run the full rule set unless the user narrows it.

### Step 6 — Screenshot when visual confirmation helps

Call `screenshot` only when the answer depends on appearance or the tree is ambiguous. Return the metadata (`originalWidth`/`originalHeight`, `screenWidth`/`screenHeight`) and the image-to-device mapping. A screenshot cannot reliably reveal text color, font size, or font family; do not infer style from pixels.

### Explicit visual viewer

Only when the user explicitly asks to visualize or open the screen in a browser ("打开可视化看看", "在浏览器里打开当前页面", "可视化当前布局", "open the UI viewer"), call MCP `open_viewer` (or the CLI fallback `node "$AUI_ROOT/dist/cli.js" view`). It captures once, writes a self-contained offline HTML viewer, and may open a browser window.

- Do not call it for ordinary summaries, dumps, element lookups, screenshots, analysis, or verification; those must never open a browser.
- Report the absolute file path and whether the browser opened (`opened` / `openError`). The viewer is a static snapshot; refs are valid only for that capture.
- The file contains device/serial/screen text; keep it under `.aui/` and do not commit it.

## uiKind policy

| uiKind | What to do |
|---|---|
| `xml` | The view tree is enough: classes, ids, text, visibility, clickable state. |
| `compose` | The semantics/view tree is enough for observation: text, descriptions, bounds, clickable state. Use `dump_ui(source="compose")` only when the user asks for Composable names or `file:line` (8–12s, may fail). |
| `mixed` | Read both trees; semantics covers Compose areas, view covers XML. |
| `unknown` | Fall back to `dump_ui(source="semantics")` and mark confidence lower. |

`source="view"` fails on non-debuggable apps. Use `source="semantics"` there and say that View classes and resource ids are unavailable.

## Output template

Answer in the user's language, using this structure:

```markdown
## Screen
- Package / Activity: <package> / <activity>
- uiKind: <xml|compose|mixed|unknown>, captured at <time>
- Device: <serial>, <width>x<height> @ <density>

## Structure
- <top-level section> — <short description>
- <next level> — ...

## Visible entry points
- <label> — id=<id>, bounds=<x,y,w,h>, center=<x,y>, clickable=<yes|no>

## Asked control
- <label>: bounds=<...>, center=<...>, clickable=<...>, enabled=<...>, class=<...>
- <direct answer: size, position, type, state>

## Uncertainties
- <offscreen / duplicate / dynamic / server-driven / non-debuggable>

## Next step (optional)
- <tap / analyze / screenshot, or "ask locate-ui-code to trace this control">
```

## Stop conditions and handoff

- This skill ends at observation. Do **not** call `locate_code`, open repository files, or scan for implementations unless the user explicitly asks where the control or page is implemented.
- Implementation, file, class, Composable, click-chain, or state questions → switch to `locate-ui-code`.
- Code or business-logic analysis of the whole screen/dialog (ViewModel, data sources, business chain) → switch to `analyze-screen-logic`.
- Before/after, regression, "did my change work", or baseline comparison → switch to `verify-ui-change`.
- When no saved baseline exists for "compare to the last version", say so and offer to save one now; never invent a before state.

## Truthfulness rules

- Never state text color, font size, font family, or style from the normalized tree. Only raw `view.properties` from `dump_ui(source="view", includeProperties=true)` may contain them, and then say the values are raw properties.
- Do not claim a control is enabled or disabled from appearance alone; read `enabled` from `find_elements`/`hit_test`, or state that it is unavailable.
- Do not describe an element that is not in the capture.
- Refs and ids are valid only for one capture; re-capture before answering a follow-up about a changed screen.
- Never modify code from this skill.

## Troubleshooting

- **No device / offline**: run `list_devices`, then guide the user to `adb devices`, USB debugging, or `ANDROID_SERIAL`. Do not retry `dump_ui` in a loop.
- **Not debuggable**: `dump_ui(source="view")` fails; use `source="semantics"` and explain that View properties are unavailable.
- **Compose capture fails**: fall back to semantics, say so once, and lower confidence. Do not retry repeatedly.
- **MCP tools missing**: use the CLI fallback above; if `dist/` is missing, report the build requirement and stop.
- **Multiple devices**: pass the same `serial` to every call.

## Additional resources

None; this skill uses only the MCP tools and the bundled CLI.
