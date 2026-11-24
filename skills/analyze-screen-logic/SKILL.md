---
name: analyze-screen-logic
description: >-
  Android-only. Use when the user asks to analyze how the CURRENT screen, dialog, bottom sheet, or visible page is implemented and how its business logic works: multiple controls at once, the page/dialog entry, UI implementation, ViewModel/state, data sources, navigation, conditions, and side effects. Chinese triggers include "分析当前界面的代码", "分析当前页面的代码", "分析当前界面/弹窗的代码/业务逻辑", "分析当前界面/弹窗的业务逻辑", "分析这个弹窗的业务逻辑", "这个弹窗的代码逻辑", "梳理当前页面的代码逻辑", "当前界面由哪些代码实现", "这个页面用到哪些 ViewModel/数据源", "把当前页面的交互、状态、数据流讲清楚". English triggers include "analyze the code and business logic behind this screen". Only in Android projects; in a non-Android repository use only when the user explicitly asks to analyze the device screen/page or explicitly mentions Android. For one control or one page entry, use locate-ui-code. For observation only, use inspect-current-screen. For before/after verification, use verify-ui-change. Not for general Android concept questions, code review, or performance.
---

# Analyzing the Current Screen's Logic

Explain the code and business logic behind the whole current screen, dialog, or bottom sheet. Core principle: **capture device evidence first, anchor the page and its sections in source, then follow state and data 1–3 hops. Read-only, evidence-first, every hop marked `confirmed` or `inferred`.**

This skill owns whole-screen/dialog analysis: implementation, state holders, data sources, navigation, conditions, and side effects. It is not a single-control locator and not a screen observer.

## Step 0 — Android project gate

Confirm the working directory (or the repo root the user named) is an Android project. Check the cwd and walk up parent directories:
`settings.gradle(.kts)`, `gradlew(.bat)`, a module `build.gradle(.kts)` applying `com.android.*`, or `AndroidManifest.xml`. Skip `node_modules/`, `build/`, and `.gradle/`.

**HARD STOP:** if no marker exists and the user did not explicitly ask to inspect a connected device screen/page and did not explicitly mention Android, do NOT call `get_state`, `dump_ui`, `find_elements`, `locate_code`, `open_viewer`, or any other tool. Reply in one sentence: this workspace is not an Android project, so source tracing is unavailable; offer to inspect a connected device screen if they want, or ask for the Android module path.

A reference like "这个按钮/这个页面/这个弹窗" alone is not an explicit device request. A connected device does not make the repository Android.

If the user explicitly asks about a connected device screen/page but no Android marker exists: observation is allowed (`get_state`/`dump_ui`/`find_elements`), but source analysis is unavailable — do not call `locate_code` until the user points at an Android module. If the user only mentions Android without an Android module present, say the module path is still needed and do not scan.


## Prerequisites

1. The target app is in the foreground. Record `package`, `activity`, and pid from `get_state`; if the foreground package differs from the repository's applicationId, say so before analyzing.
2. The working directory is the Android repository root; if not, ask for the path. Without it, stop at observation and say that source analysis needs the project root.
3. MCP tools come from `android-ui`: `get_state`, `dump_ui`, `find_elements`, `hit_test`, `locate_code`, `screenshot`.
4. If MCP is unavailable, fall back to the CLI, where `AUI_ROOT` is the plugin root (the directory that contains `dist/`, `scripts/`, and `skills/`): `${CLAUDE_PLUGIN_ROOT}` in Claude Code, otherwise your plugin checkout. `android-ui` on `PATH` is equivalent:
   ```bash
   mkdir -p .aui
   node "$AUI_ROOT/dist/cli.js" state --json
   node "$AUI_ROOT/dist/cli.js" dump --json --out .aui/current.json
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

## Step 2 — Scope the screen or dialog

Before touching source, describe the surface:

1. Classify it: full page, dialog, bottom sheet, or overlay.
2. List top-level sections in visible order (app bar, content blocks, lists, tabs, action bar).
3. List the key controls per section (title, primary action, inputs, toggles) with text/id/class and bounds when useful.
4. Note dynamic or server-driven areas, loading/empty/error states, and anything cut off or offscreen.

This map is the spine of the report: every later source claim should map back to one of these sections.

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

Map each screen section to a file, Composable, layout, or dialog class with `file:line`. Read the top candidates (±15 lines) to confirm; a score or snippet is not proof. For the complete Compose/XML/ViewBinding mapping and edge cases, see `../locate-ui-code/references/anchor-resolution.md`.

## Step 4 — State and data chain

For each significant section, answer:

- **State holder:** ViewModel, presenter, state holder, or Compose state (`collectAsStateWithLifecycle`, `remember`, `uiState` type).
- **Data source:** UseCase, Repository, local cache/database, API/network, or static/config data.
- **Wiring:** how the screen observes state and how events are dispatched (lambdas, method references, `LaunchedEffect`).
- **Navigation and arguments:** route arguments, saved state, deep links, and where the screen is entered from.
- **Conditions:** login/auth, permissions, experiment/feature flags, empty/error states that change what renders or is enabled.
- **Side effects:** analytics, refresh, cache invalidation, navigation, toasts/snackbars.

Follow 1–3 hops unless the user asks for depth. Mark each hop `confirmed` (code read) or `inferred` (deduced from names, route, or wiring). Do not invent a call chain to fill the template. For common structures and stopping conditions, see `../locate-ui-code/references/business-chain.md`.

## Step 5 — Interaction and navigation

For the primary actions on the surface:

1. Find the click/scroll/input handler in source (`setOnClickListener`, binding lambda, `android:onClick`, `onClick` parameter, `pointerInput`).
2. Follow it to the state holder/repository or navigation call, 1–2 hops.
3. Record route arguments and what the next screen expects.
4. Note guards (validation, permissions, feature flags) that can block the action.

Do not tap unless the user asks; if interaction evidence is needed, tap once and re-capture. Never turn this into a test loop.

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
- <section> — <purpose> — <key controls / labels> — <dialog|page|sheet>

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
- <files to read next, or "ask locate-ui-code to trace one control">
```

## Boundaries

- One control's implementation, click chain, or state → `locate-ui-code`. This skill analyzes the whole screen/dialog.
- Observation only ("what is on this screen", bounds, clickable, class) → `inspect-current-screen`; it never calls `locate_code`.
- Before/after, regression, "did my change work" → `verify-ui-change`.
- Never edit code, build, install, or tap unless explicitly asked. This skill is read-only.
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

- `../locate-ui-code/references/business-chain.md` — typical UI → ViewModel/UseCase/Repository structures and stopping conditions.
- `../locate-ui-code/references/anchor-resolution.md` — complete Compose/XML/string/navigation/ViewBinding mapping.