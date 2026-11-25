---
name: trace-view-wiring
description: >-
  Android-only. Use when the user asks how ONE control on screen is wired in the code: its implementing class, where its click handler is attached, what controls its visibility, and where its text, image, or background comes from. Triggers include "这个按钮在哪实现的", "这个控件的实现类", "点击处理挂在哪", "显隐逻辑在哪控制", "文案是怎么设进来的", "图片/背景在哪设置", "where is this button implemented", "where is this click handler attached", "what controls this view's visibility", "trace this control's wiring". Owns: one control's wiring — implementation, events, visibility, and content injection. Not: screen facts (capture-ui), property values (inspect-view-attribute), a block's data flow (trace-ui-to-logic), defect judgments (audit-ui). Only in Android projects; in a non-Android repository use only when the user explicitly mentions Android.
---

# Tracing One Control's Wiring

Take one control on the live screen and answer four wiring questions: **who implements it, what handles its clicks, what decides whether it is shown, and where its content comes from.**

## Scope

| The user asks | Go to |
|---|---|
| What is on screen, bounds, coordinates | `capture-ui` |
| Margin, padding, measured size, text size values | `inspect-view-attribute` |
| A list or section: UI → ViewModel → data source | `trace-ui-to-logic` |
| Is there a layout defect here | `audit-ui` |

This skill owns exactly one control. A whole section's business chain is `trace-ui-to-logic`, even when the user names a control inside it.

## Step 0 — Android project gate

Look for an Android project in the cwd or any parent: `settings.gradle(.kts)`, `gradlew(.bat)`, a module `build.gradle(.kts)` applying `com.android.*`, or `AndroidManifest.xml`. Skip `node_modules/`, `build/`, `.gradle/`.

| Workspace | User asked about | Allowed |
|---|---|---|
| Android project | anything | everything |
| Not Android | a device screen/page, or mentioned Android | observation only — no `locate_code` |
| Not Android | anything else | **no tool at all** |

**HARD STOP** on the third row: call nothing, reply in one sentence that this workspace is not an Android project, then offer device observation or ask for the Android module path. A bare "这个按钮/这个页面/这个弹窗" is not an explicit device request, and a connected device does not make the repository Android.

Source tracing has a stricter floor than observation: `locate_code` needs an actual Android module. If the user mentions Android but no module is present, say the module path is still needed and do not scan.

## The four questions

Answer only the ones the user asked, but know what each one means, because they resolve to different places in the code:

| Question | Typical landing point | How to find it |
|---|---|---|
| **Implementation** — which class renders this | custom `View` subclass, a layout file, or a Composable | `class-definition`, `layout-id`, `compose-definition` candidates |
| **Events** — what runs on tap | `setOnClickListener`, binding lambda, `android:onClick`, `onClick` parameter, `pointerInput` | `click-handler`, `on-click-attr`, `id-usage-strong` |
| **Visibility** — what decides shown/hidden | the state read around `isVisible`, `visibility =`, `if (...) { }`, `AnimatedVisibility`, `alpha` | follow the condition to its state holder |
| **Content** — where the text / image / background is set | `setText`, binding expression, `stringResource`, `text =`, `load(...)`, `setImageDrawable`, `background =` | `string-usage`, `string-usage-xml`, `literal-text`, `binding-usage` |

A control usually needs two or three of these, not all four. Do not invent an answer for a question the code does not answer; say it was not found in 1–2 hops.

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
| release build (`--source view` fails) | `dump_ui(source="dumpsys")` | Real View classes and resource ids without a debug build; no text |

Notes:

- `ref` values (`v*` / `s*` / `c*`) are valid only for one capture. Re-capture after the UI changes; never reuse stale refs.
- `visibleOnly` only affects `format="tree"`; JSON output still contains invisible nodes, so filter them yourself.
- When the user refers to "the top-left of the screen" or "the position in the screenshot", call `screenshot` and use the returned `width` / `originalWidth` / `scale` for coordinate mapping. Never treat image pixels as device coordinates; map them with `coordinateMapping.imageToDevice` and then call `hit_test` in device coordinates.
- Take screenshots only when visual information is genuinely needed. Text, ids, and Compose anchors are usually sufficient.
- If Compose capture fails (non-debuggable app, Android Studio not installed, Compose version mismatch), do not retry repeatedly. Fall back to semantics plus string/id anchors and mark source confidence as medium or low in the conclusion. Do not claim the result came from the Compose tree.

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

1. The target may be offscreen or collapsed: say it is not in this capture, and ask the user to scroll or expand it. Then re-run `dump_ui` and `find_elements`; remind the user that old refs are invalid. This skill never scrolls the device itself.
2. Icon buttons without text: use `by="desc"` or `by="id"`.
3. A dialog/overlay may belong to another window: inspect `windows` in `get_state`, then `dump_ui(source="view", window="<index>")` if needed.
4. Still nothing: go to Step 3 and fall back to code search using nearby static text, ids, or class names; follow `references/repo-search-recipes.md`.

**Do not turn "not in this capture" into "not in the repository".** One frame is evidence about the screen, not about the codebase.

- If the user names a control that is not in the captured tree (a closed dialog, another tab, a scrolled-off item), say it is not on the current screen, then ask the user to open it and re-capture, or search the source for the literal.
- For Compose, search the quoted literal (`Text("Close")`, `contentDescription = "Close"`) instead of assuming attribute syntax such as `android:text` / `text =`; `locate_code` reports these as `literal-text` candidates.
- If source hits exist while the control is absent on screen, report them as `not currently visible` and keep them separate from capture evidence. Never claim the repository lacks the control based on a single frame.

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
node "$AUI_ROOT/scripts/locate-code.mjs" \
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
7. Content: text is a `Text(...)` literal or `stringResource(R.string.x)`; images use `painterResource`, `rememberAsyncImagePainter`, or a `coil` `AsyncImage`; a background is a `Modifier.background(...)` or a `Surface` color. Trace the argument to where the value is produced, not just where it is passed.

### XML

1. Use `layout-id` to locate the defining layout; when `<include>` is present, use `layout-include-chain` to find the entry layout.
2. Use `layout-inflation` / `binding-usage` to find the Activity/Fragment/Adapter/Dialog inflate site.
3. Events: `findViewById` + `setOnClickListener`, `binding.<id>.setOnClickListener`, DataBinding lambdas, and `android:onClick` (`click-handler` candidates).
4. Follow the handler into the ViewModel/Repository. If the handler only emits an event, continue to the subscriber.
5. List items (`item_*.xml`) are usually bound by an Adapter/ViewHolder; business logic lives in the Adapter, DiffUtil, and item model, not in the item layout.
6. Content: text is `android:text` in the layout, `setText(...)`, or a binding expression; images are `android:src`, `setImageResource`/`setImageDrawable`, or a loader such as Glide/Coil; a background is `android:background`, `setBackgroundResource`, or a drawable XML. Follow the setter to the value's origin.
7. With multiple flavors/modules there may be duplicate layouts or ids; compare `sourceSets`, module dependencies, and the actually used flavor, and call out the ambiguity.

### Semantics fallback

When only the semantics tree is available, `text` / `contentDescription` are UI evidence, not source anchors. Build candidates from string resources, `testTag`, and literals, and mark confidence as low in the conclusion. Do not claim a Composable/Activity is the source unless the code matches.

## Step 5 — Follow to the state holder

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
