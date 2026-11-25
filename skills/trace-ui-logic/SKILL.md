---
name: trace-ui-logic
description: >-
  Android-only. Use when the user asks how a BLOCK of the current screen works end to end: a feed list, a card group, a form, a dialog body, or a bottom sheet section — how its UI maps to state and where the data comes from. Triggers include "分析这块区域的业务逻辑", "分析这个 feed 列表", "这个卡片组的数据从哪来", "这块 UI 到数据层是怎么走的", "分析当前弹窗的业务逻辑", "ui2logic", "analyze this block's logic", "where does this list's data come from", "trace this block from UI to data". Owns: one block's logic chain — UI block, state holder, data source, and the wiring between them. Not: one element's wiring (trace-view-wiring), screen facts (capture-ui), attribute values (inspect-view-attribute), defect judgments (audit-ui). Only in Android projects; in a non-Android repository use only when the user explicitly mentions Android.
---

# Tracing a Block's UI to Its Logic

Take one visible block of the screen — a list, a card group, a form, a dialog body — and explain how it is built and where its data comes from. Core principle: **capture the block once, anchor it in source, then follow state and data 1–3 hops. Every hop is marked `confirmed` or `inferred`.**

## Scope

| The user asks | Go to |
|---|---|
| One element: who implements it, click, visibility, content | `trace-view-wiring` |
| What is on screen, bounds, coordinates | `capture-ui` |
| This View's margins / padding / text size | `inspect-view-attribute` |
| Layout defects on this screen | `audit-ui` |

The dividing line is **granularity**: one element is `trace-view-wiring`; a group of elements that share one state holder is this skill. "The delete button in this feed item" is one element; "why does this feed item show a delete button" is this section's data flow.

## Step 0 — Android project gate

Look for an Android project in the cwd or any parent: `settings.gradle(.kts)`, `gradlew(.bat)`, a module `build.gradle(.kts)` applying `com.android.*`, or `AndroidManifest.xml`. Skip `node_modules/`, `build/`, `.gradle/`.

| Workspace | User asked about | Allowed |
|---|---|---|
| Android project | anything | everything |
| Not Android | a device screen/page, or mentioned Android | observation only — no `locate_code` |
| Not Android | anything else | **no tool at all** |

**HARD STOP** on the third row: call nothing, reply in one sentence that this workspace is not an Android project, then offer device observation or ask for the Android module path. A bare "这个按钮/这个页面/这个弹窗" is not an explicit device request, and a connected device does not make the repository Android.

Source tracing has a stricter floor than observation: `locate_code` needs an actual Android module. If the user mentions Android but no module is present, say the module path is still needed and do not scan.

## Prerequisites

1. The target app is in the foreground. Record `package`, `activity`, and pid from `get_state`; if the foreground package differs from the repository's applicationId, say so before analyzing.
2. The working directory is the Android repository root; if not, ask for the path. Without it, stop at observation and say that source analysis needs the project root.
3. MCP tools come from `android-layout`: `get_state`, `dump_ui`, `find_elements`, `hit_test`, `locate_code`, `screenshot`.
4. If MCP is unavailable, fall back to the CLI, where `ALM_ROOT` is the plugin root (the directory that contains `dist/`, `scripts/`, and `skills/`): `${CLAUDE_PLUGIN_ROOT}` in Claude Code, otherwise your plugin checkout. `android-layout` on `PATH` is equivalent:
   ```bash
   mkdir -p .alm
   node "$ALM_ROOT/dist/cli.js" state --json
   node "$ALM_ROOT/dist/cli.js" dump --json --out .alm/current.json
   ```
   If `dist/` is missing, report the build requirement and stop; do not fabricate a screen.

## Step 1 — Capture the screen

Call in parallel:

- `get_state`: device, screen size/density, foreground `package`, `activity`, pid, and `windows`.
- `dump_ui(source="auto", format="tree", visibleOnly=true)`: `uiKind` (`xml` / `compose` / `mixed` / `unknown`) and the compact visible tree.

Inspect `windows` from `get_state`:

- A dialog, bottom sheet, or overlay in a separate window → `dump_ui(source="view", window="<index-or-name>")` to capture that window. A View window may also be captured per window when the primary tree shows only the Activity.
- A Compose dialog may share the Activity window; if the dialog nodes are in the primary tree, no extra window dump is needed.
- If the dialog belongs to another package (system dialog, IME, another app), say so and analyze only the target app's part.

For Compose screens, add `dump_ui(source="compose", maxNodes=2000)` when you need Composable names and `file:line` (8–12s; may fail). If it fails, continue with semantics and mark source confidence lower.

Refs (`v*` / `s*` / `c*`) are valid only for this capture; re-capture after the screen changes.

## Step 2 — Scope the block

Before touching source, describe the block the user named. If they named a list, a card group, or a section, that is the boundary — do not expand to the whole screen unless they ask.

1. Name the block and its bounds: the list, the card group, the form, the dialog body.
2. List the elements it contains, in visible order, with text/id/class.
3. Note which items are repeated (list rows) and which are single — the repeated ones usually route through an Adapter or a `LazyColumn` item.
4. Note loading/empty/error states and anything that changes with data.

This map is the spine of the report: every later source claim maps back to one row of it.

## Step 3 — Entry and UI implementation

Resolve the page/dialog owner:

- **Activity/Fragment:** use `activity` from `get_state`, then search the class declaration and `AndroidManifest.xml`. Find `setContentView(R.layout.x)`, the Fragment's `onCreateView`, or ViewBinding inflation.
- **Compose:** use Composable names from the Compose dump near the root; follow `compose-callsite` to parents and `NavHost` / `composable("route")` to find the route that renders it.
- **Dialog/BottomSheet:** look for `DialogFragment`, `BottomSheetDialogFragment`, `AlertDialog`, `PopupWindow`, `show()` calls, or a navigation `<dialog>` destination.

Use `find_elements` / `hit_test` to confirm which visible section corresponds to which anchor. Then call `locate_code` with only the anchors that exist (text, desc, id, Compose name/file/line, class):

```text
locate_code(root="<repo root>", text=["<section title>"], id=["<id>"],
            composeName="<name>", composeFile="<file>", composeLine=<line>)
```

Map each screen section to a file, Composable, layout, or dialog class with `file:line`. Read the top candidates (±15 lines) to confirm; a score or snippet is not proof. For the complete Compose/XML/ViewBinding mapping and edge cases, see `../trace-view-wiring/references/anchor-resolution.md`.

## Step 4 — State and data chain

For each significant section, answer:

- **State holder:** ViewModel, presenter, state holder, or Compose state (`collectAsStateWithLifecycle`, `remember`, `uiState` type).
- **Data source:** UseCase, Repository, local cache/database, API/network, or static/config data.
- **Wiring:** how the screen observes state and how events are dispatched (lambdas, method references, `LaunchedEffect`).
- **Navigation and arguments:** route arguments, saved state, deep links, and where the screen is entered from.
- **Conditions:** login/auth, permissions, experiment/feature flags, empty/error states that change what renders or is enabled.
- **Side effects:** analytics, refresh, cache invalidation, navigation, toasts/snackbars.

Follow 1–3 hops unless the user asks for depth. Mark each hop `confirmed` (code read) or `inferred` (deduced from names, route, or wiring). Do not invent a call chain to fill the template. For common structures and stopping conditions, see `../trace-view-wiring/references/business-chain.md`.

## Step 5 — Interaction and navigation

For the primary actions on the surface:

1. Find the click/scroll/input handler in source (`setOnClickListener`, binding lambda, `android:onClick`, `onClick` parameter, `pointerInput`).
2. Follow it to the state holder/repository or navigation call, 1–2 hops.
3. Record route arguments and what the next screen expects.
4. Note guards (validation, permissions, feature flags) that can block the action.

This skill reads code and captures the screen; it never taps, swipes, types, or sends key events. Interaction chains are traced through source only, and anything you could not confirm from code is marked `inferred`.

## Output template

Answer in the user's language, compactly, without full-file pastes:

```markdown
## Conclusion
<What this screen/dialog is, which code owns it, and the core business flow in 2–3 sentences.>

## Screen evidence
- Package / Activity: <package> / <activity>, uiKind=<kind>, captured at <time>
- Device: <serial>, <width>x<height> @ <density>
- Window: <primary or window name/index; separate-window dialog if any>

## Screen map
- <section> — <purpose> — <key elements / labels> — <dialog|page|sheet>

## Entry & UI implementation
- <section> → <file:line> (<Activity/Fragment/Composable/layout/dialog class>) — confirmed|inferred

## State & data flow
1. <UI section> → <handler/state read> (<file:line>) — confirmed|inferred
2. → <ViewModel/state holder> (<file:line>) — confirmed|inferred
3. → <UseCase/Repository/API/cache> (<file:line>) — confirmed|inferred

## Interaction & navigation
- <action> → <handler> → <navigation/route or side effect> (<file:line>) — confirmed|inferred

## Conditions & side effects
- <auth/permission/flag/empty state> — <effect> (<file:line>)
- <analytics/refresh/cache> — <effect> (<file:line>)

## Uncertainties
- <dynamic/server-driven text, flavor/module ambiguity, failed Compose capture, stale build, other-package dialog>

## Next steps
- <files to read next, or "ask trace-view-wiring to trace one element">
```


- Never edit code, build, install, or drive the device. This skill is read-only.
- Refs and ids are valid for one capture; re-capture before a follow-up on a changed screen.

## Quality rules

- Every source claim has `file:line`; anything without one is `inferred`.
- Read candidate files before concluding; snippets are not context.
- Do not treat a string resource or a route name as the full implementation.
- The device UI and the repository may differ (stale build, different branch/flavor). State the captured package and time, and flag mismatches.
- If the dialog is owned by another package or is system UI, say so instead of forcing a source mapping.

## Troubleshooting

- **No device / offline:** run `list_devices`, then guide the user to `adb devices` or `ANDROID_SERIAL`; do not retry `dump_ui` in a loop.
- **Non-debuggable app:** `source="view"` fails; use `source="semantics"`, state that View properties are unavailable, and lower source confidence.
- **Compose capture fails:** fall back to semantics plus string/id anchors; do not claim the result came from the Compose tree.
- **Dialog not in the primary tree:** inspect `windows` and dump that window by index/name.
- **No code candidates:** try longer static text, nearby labels/ids, or a wider root; conclude server-driven content rather than inventing a file.

## Additional resources

- `../trace-view-wiring/references/business-chain.md` — typical UI → ViewModel/UseCase/Repository structures and stopping conditions.
- `../trace-view-wiring/references/anchor-resolution.md` — complete Compose/XML/string/navigation/ViewBinding mapping.