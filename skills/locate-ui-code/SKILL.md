---
name: locate-ui-code
description: >-
  Android-only. Use when the user asks about ONE control or page entry on the current Android screen: where it is implemented, which Activity/Fragment/Composable/route owns a page or dialog, or where a label, icon, click handler, visibility rule, or state comes from. Chinese triggers include "定位当前页面中的 X 按钮/入口/图标", "这个页面/弹窗是哪个 Activity/Fragment/Composable/route 实现的", "这个控件/页面是哪些代码实现的", "按 UI 找已有业务逻辑", "这个点击事件/可见性/状态在哪个 ViewModel/Repository", "这个按钮在哪实现的", "这个 tab/入口的代码", "这个文案/图标在哪个 strings.xml/代码里", "这个图标是什么资源", "点了会发生什么", "这个状态从哪来的", "为什么这个按钮不显示", "把当前界面映射到 Android 源码". Only in Android projects; in a non-Android repository use only when the user explicitly mentions Android. For the whole screen/dialog with multiple controls, use analyze-screen-logic. For observation only (bounds/size/clickable/class), use inspect-current-screen. Not for general Android questions, code review, performance, or reading a layout file without a live screen.
---

# UI → Code Location

Turn a control on the live device screen into verifiable source anchors and a business chain. Core principle: **capture device evidence first, then code anchors, then read the code to verify**. Never guess the implementation from text alone.

## Scope boundary

This skill traces UI to source. If the user only wants to see the current screen or a control's bounds, size, position, clickable/enabled state, class, or icon on screen, use `inspect-current-screen` instead and do not scan the repository. For before/after or regression checks, use `verify-ui-change`. For code and business-logic analysis of the whole current screen/dialog — implementation, ViewModel, data sources, and business chain — use `analyze-screen-logic`; this skill owns one control or the page entry only.

## Step 0 — Android project gate

Confirm the working directory (or the repo root the user named) is an Android project. Check the cwd and walk up parent directories:
`settings.gradle(.kts)`, `gradlew(.bat)`, a module `build.gradle(.kts)` applying `com.android.*`, or `AndroidManifest.xml`. Skip `node_modules/`, `build/`, and `.gradle/`.

**HARD STOP:** if no marker exists and the user did not explicitly ask to inspect a connected device screen/page and did not explicitly mention Android, do NOT call `get_state`, `dump_ui`, `find_elements`, `locate_code`, or any other tool. Reply in one sentence: this workspace is not an Android project, so source tracing is unavailable; offer to inspect a connected device screen if they want, or ask for the Android module path.

A reference like "这个按钮/这个页面/这个弹窗" alone is not an explicit device request. A connected device does not make the repository Android.

If the user explicitly asks about a connected device screen/page but no Android marker exists: observation is allowed (`get_state`/`dump_ui`/`find_elements`), but source analysis is unavailable — do not call `locate_code` until the user points at an Android module. If the user only mentions Android without an Android module present, say the module path is still needed and do not scan.


## Prerequisites

1. Confirm `adb` is available and the device is online: use MCP `list_devices`, or `adb devices`. If multiple devices are connected, choose a `serial` and pass the same one to `get_state` / `dump_ui` / `find_elements` / `hit_test` / `screenshot` / `tap`.
2. Confirm the working directory is the target Android repository root; check `settings.gradle(.kts)`, `gradlew`, and `app/`. If you are not inside the repository, ask the user for the path or infer it from the nearest relevant module.
3. The plugin MCP tools are provided by the `layout-inspector-android` server: `get_state`, `dump_ui`, `find_elements`, `locate_code`, `hit_test`, `screenshot`, `analyze_ui`, `diff_ui`, `tap`, `swipe`.
4. If MCP is unavailable, fall back to the CLI:
   ```bash
   mkdir -p .dli
   node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" state --json
   node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" dump --json --out .dli/current.json
   ```
   If `dist/` does not exist, the plugin has not been built. Tell the user to run `npm install && npm run build` in the plugin directory; do not fabricate results.
5. The target app must be in the foreground. If the foreground package differs from the repository's applicationId, state the mismatch first so another app's UI is not mistaken for the target.

## Step 1 — Capture UI evidence

Call these in parallel:

- `get_state`: device, screen size/density, foreground `package`, `activity`, pid, windows.
- `dump_ui(source="auto", format="tree", visibleOnly=true)`: returns `uiKind` (`xml` / `compose` / `mixed`) and a compact tree.

Then decide whether to capture more based on `uiKind`:

| uiKind | Additional action | Purpose |
|---|---|---|
| `compose` | `dump_ui(source="compose", maxNodes=2000)` | Composable names, `file:line`, parameter text; takes 8–12s but is worth it |
| `mixed` | Keep view + semantics; capture compose only when tracing source | Covers both XML and Compose areas |
| `xml` | Nothing extra | View classes, resource ids, and text are enough |
| `unknown` | Try `dump_ui(source="semantics")` first | Fallback for non-debuggable apps or restricted captures |

Notes:

- `ref` values (`v*` / `s*` / `c*`) are valid only for one capture. Re-capture after the UI changes; never reuse stale refs.
- `visibleOnly` only affects `format="tree"`; JSON output still contains invisible nodes, so filter them yourself.
- When the user refers to "the top-left of the screen" or "the position in the screenshot", call `screenshot` and use the returned `width` / `originalWidth` / `scale` for coordinate mapping. Never treat image pixels as device coordinates. Then use `hit_test` or `tap(imageX=..., imageY=..., imageWidth=..., imageHeight=...)`.
- Take screenshots only when visual information is genuinely needed. Text, ids, and Compose anchors are usually sufficient.
- If Compose capture fails (non-debuggable app, Android Studio not installed, Compose version mismatch), do not retry repeatedly. Fall back to semantics plus string/id anchors and mark source confidence as medium or low in the conclusion. Do not claim the result came from the Compose tree.

## Step 1.5 — Page-level location (no specific control)

When the user asks "which Activity/Fragment/Composable/route implements this page/dialog", skip control search and locate the page entry directly:

- XML/View pages: take the `activity` from `get_state` → `rg 'class .*ProfileActivity'` (replace with the actual class name); find its declaration in `AndroidManifest.xml`; inside the Activity look for `setContentView(R.layout.x)` or the Fragment's `onCreateView` / Binding `inflate`.
- Compose pages: call `dump_ui(source="compose", maxNodes=2000)` and read the Composable names near the root, then use `locate_code`'s `compose-callsite` to find parents and `NavHost` / `composable("route")`.
- Dialogs/BottomSheets: look for `DialogFragment`, `BottomSheetDialogFragment`, and `show()` calls; check `<dialog>` destinations in Navigation XML.
- Output only the page entry, layout/Composable, and route. Do not continue to controls; enter Step 2 only when the user explicitly asks for "the X control on this page".

## Step 2 — Locate the target control

Search in this priority order:

1. `find_elements(query="<text>", by="text", match="exact", both=true)`
2. When the text is not unique: `match="contains"`, then narrow with `contentDescription`, `resourceId`, `clickable`, `visible`, bounds, and parent path.
3. When the user points at an entry/icon rather than text: use `by="desc"`, `by="id"`, or a short class name from the `dump_ui` tree (`Button`, `ImageButton`, `Text`).
4. When the user gives coordinates or a screenshot position: `hit_test(x, y)`, using `index` to cycle through overlapping candidates.

When multiple candidates remain, do not pick the first one. Narrow using:

- Position (does the bounds match the user's description?);
- `clickable=true`;
- Visible with a reasonable area (exclude full-screen containers);
- Static siblings under the same parent path;
- Whether the text comes from a string resource (which explains language differences).

If two or more candidates remain equally plausible, give the user the candidate list and distinguishing evidence instead of guessing.

When nothing is found:

1. The target may be offscreen or collapsed: use `swipe` to scroll/expand, then re-run `dump_ui` and `find_elements`; remind the user that old refs are invalid.
2. Icon buttons without text: use `by="desc"` or `by="id"`.
3. A dialog/overlay may belong to another window: inspect `windows` in `get_state`, then `dump_ui(source="view", window="<index>")` if needed.
4. Still nothing: go to Step 3 and fall back to code search using nearby static text, ids, or class names; follow `references/repo-search-recipes.md`.

Extract and record anchors:

- `text` / `contentDescription`
- `resourceId` (drop the package prefix, e.g. `profile_tab`)
- Compose: `compose.name`, `compose.fileName`, `compose.lineNumber`
- `className`
- `bounds`, `center`, `clickable`
- Capture time, `uiKind`, `source`

## Step 3 — Generate code candidates

Prefer MCP `locate_code` (read-only, no shell required):

```text
locate_code(
  root="<repo root>",
  text=["Me"],
  desc=["Open profile"],
  id=["profile_tab"],
  composeName="ProfileTab",
  composeFile="ProfileScreen.kt",
  composeLine=120,
  className=["ProfileEntryView"],
  limit=25
)
```

If `locate_code` is unavailable, run the equivalent script:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/locate-code.mjs" \
  --root . \
  --text "Me" \
  --desc "Open profile" \
  --id "profile_tab" \
  --compose-name "ProfileTab" \
  --compose-file "ProfileScreen.kt" \
  --compose-line 120 \
  --class "ProfileEntryView" \
  --json
```

Rules:

- Arguments are repeatable; pass only what exists and never invent anchors. `--id` accepts both `profile_tab` and `com.example:id/profile_tab`.
- If there is a `contentDescription`, pass it with `--desc`, not `--text`. For custom Views use `--class`.
- `anchors.strings`: string resources matched by text (including `values-zh` and other qualifiers).
- `anchors.ids`: normalized ids.
- `anchors.compose`: Compose definitions (name, file, line).
- `candidates[]`: ranked code locations with `kind`, `reason`, and `snippet`.
- Read `anchors` first to judge whether the evidence is trustworthy, then read the top 5–8 candidates around the reported lines (±15 lines). **Scores are hints; always open the file to confirm.**
- In large repositories, use `--exclude <path>` to skip vendored code, generated directories, or other product lines. Tests are excluded by default; add `--include-tests` when needed.

Common `kind` values (the script output is authoritative for the full list):

| kind | Meaning |
|---|---|
| `compose-definition` / `compose-callsite` | Compose definition / call site |
| `compose-location` | File:line reported by the inspector; may be a definition or a call site, so confirm by name |
| `layout-id` / `layout-include-chain` | Id defined in XML / entry layouts that include it via `<include>` |
| `binding-usage` / `id-usage` / `id-usage-strong` | ViewBinding property / `R.id` reference / `findViewById` or listener |
| `string-definition` / `string-usage` / `string-usage-compose` / `string-usage-xml` | String resource definition / code reference / `stringResource` / XML `@string` |
| `layout-inflation` / `inflation` / `layout-text` | `setContentView` · `inflate` · Binding entry / XML literal text |
| `literal-text` / `test-tag` | Source literal / `testTag`, `contentDescription` |
| `navigation` / `on-click-attr` / `click-handler` | Navigation node, `android:onClick`, handler function |
| `class-definition` | Custom View/class definition |

If the script returns no candidates: use longer static text, a nearby label or id, `--include-tests`, or a wider `--root`. Also consider that the text may be server-driven, templated, or formatted. Do not force a match with a single short character. See `references/repo-search-recipes.md` for the detailed troubleshooting order.

## Step 4 — Trace source by UI type

For the full mapping, edge cases, and multi-module handling, see `references/anchor-resolution.md`.

### Compose

1. Open the `compose-definition` `file:line` and read the function signature, parameters, `Modifier`, `onClick`, and state reads. If you only have `compose-location` (the inspector's reported line), the line may be a definition or a call site; confirm by name and do not assert from the line number alone.
2. When text comes from `stringResource(R.string.x)`, confirm the value in `strings.xml`; under localization the text is only an entry point and the real anchor is the `R.string` name.
3. Use `compose-callsite` to find the parent Composable / `NavHost` call and determine which route, tab, or conditional branch renders this entry.
4. Click chain: `onClick` parameter → the lambda passed by the caller → ViewModel method / navigation / callback. Follow 1–2 hops unless the user asks for the full chain.
5. State chain: `collectAsStateWithLifecycle`, `LaunchedEffect`, `remember`, and the `uiState` type; then follow the `StateFlow` source into the ViewModel.
6. A tap on a Compose screen may land on `pointerInput`, `clickable`, `combinedClickable`, or a parent container. Do not assume it is always a `Button`.

### XML

1. Use `layout-id` to locate the defining layout; when `<include>` is present, use `layout-include-chain` to find the entry layout.
2. Use `layout-inflation` / `binding-usage` to find the Activity/Fragment/Adapter/Dialog inflate site.
3. Events: `findViewById` + `setOnClickListener`, `binding.<id>.setOnClickListener`, DataBinding lambdas, and `android:onClick` (`click-handler` candidates).
4. Follow the handler into the ViewModel/Repository. If the handler only emits an event, continue to the subscriber.
5. List items (`item_*.xml`) are usually bound by an Adapter/ViewHolder; business logic lives in the Adapter, DiffUtil, and item model, not in the item layout.
6. With multiple flavors/modules there may be duplicate layouts or ids; compare `sourceSets`, module dependencies, and the actually used flavor, and call out the ambiguity.

### Semantics fallback

When only the semantics tree is available, `text` / `contentDescription` are UI evidence, not source anchors. Build candidates from string resources, `testTag`, and literals, and mark confidence as low in the conclusion. Do not claim a Composable/Activity is the source unless the code matches.

## Step 5 — Business chain

For the typical UI → ViewModel/UseCase/Repository structure and stopping conditions, see `references/business-chain.md`.

When the user asks for "related code logic", answer at least:

- **Entry**: Activity/Fragment/Composable/custom View, `file:line`.
- **Interaction**: click/scroll/input handler, `file:line`.
- **State**: where the UI state comes from (ViewModel, Repository, local cache, API).
- **Conditions**: login, permissions, experiment flags, A/B tests, empty states that affect visibility or clickability.
- **Side effects**: analytics, navigation, refresh, cache invalidation.

Mark every hop as `confirmed` (code read) or `inferred` (deduced from naming/navigation only). Do not invent call chains for the sake of completeness.

## Step 6 — Output

Use a compact evidence report; do not paste entire files. The template is in `references/output-template.md`. Minimum structure:

1. **Conclusion**: entry + `file:line`, one or two sentences.
2. **UI evidence**: text/description, id, bounds, uiKind, capture time.
3. **Code anchors**: string/layout/Compose definitions.
4. **Chain**: numbered steps, each with `file:line` and `confirmed|inferred`.
5. **Uncertainties**: multiple flavors, dynamic text, server-driven content, missing call sites.
6. **Next steps**: files to read/change first and how to verify (MCP `dump_ui` + `diff_ui` + `analyze_ui`, or CLI `dump`/`diff`/`analyze`, plus unit tests).

## Quality rules

- Any conclusion without `file:line` must be marked as inference.
- Read candidate code before concluding; a `snippet` does not replace context.
- Do not modify code unless the user explicitly asks; this skill is read-only by default.
- Do not treat a snippet line as the complete implementation.
- The device UI and the repository may differ (not reinstalled, different branch). State the capture time and package in the conclusion, and flag obvious mismatches.

## Additional resources

- `references/anchor-resolution.md` — complete Compose/XML/string/navigation/ViewBinding mapping and edge cases.
- `references/business-chain.md` — common structures and stopping conditions from a control event to ViewModel/UseCase/Repository.
- `references/repo-search-recipes.md` — `rg` recipes for large repositories, exclusions, and candidate verification.
- `references/output-template.md` — report template and examples.
