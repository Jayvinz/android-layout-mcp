---
description: Analyze the code, state, data flow, and business logic behind the current Android screen, dialog, or bottom sheet
argument-hint: [optional screen/dialog description or package name]
---

# Analyze current screen or dialog logic

Context: $ARGUMENTS

Follow the `analyze-screen-logic` skill. This is read-only: do not edit code.

## Step 0 — Android project gate

Confirm the working directory (or the repo root the user named) is an Android project:
`settings.gradle(.kts)`, `gradlew(.bat)`, a module `build.gradle(.kts)` applying `com.android.*`, or `AndroidManifest.xml`.

If none:
- continue only when the user explicitly asked to inspect the device screen/page or explicitly mentioned Android;
- otherwise stop, say this plugin targets Android projects, and never scan the repository or call `locate_code`.

A connected device does not make the repository Android.

**HARD STOP:** if no Android marker exists and the user did not explicitly ask to inspect a connected device screen/page and did not explicitly mention Android, do NOT call `get_state`, `dump_ui`, `find_elements`, `locate_code`, `open_viewer`, or any other tool. Say the workspace is not an Android project; offer device observation or ask for the Android module path. A reference like "这个按钮/这个页面/这个弹窗" alone is not an explicit device request.

## Procedure

1. Call `get_state` to confirm the foreground package, activity, pid, screen, and `windows`.
2. Capture with `dump_ui(source="auto", format="tree", visibleOnly=true)` and record `uiKind`.
3. If a dialog, bottom sheet, or overlay is in a separate window, call `dump_ui(source="view", window="<index-or-name>")`. A Compose dialog may share the Activity window.
4. Scope the surface: page, dialog, bottom sheet, or overlay; list its top-level sections and key controls. If the dialog belongs to another package, say so.
5. Identify the owner: Activity/Fragment/Composable/route/dialog class. On Compose screens, add `dump_ui(source="compose", maxNodes=2000)` when Composable `file:line` is needed.
6. Call `locate_code` with only the anchors that exist, then map each section to a file, Composable, layout, or dialog class with `file:line`; read the candidates to confirm.
7. Follow state and data 1–3 hops: ViewModel/state holder → UseCase/Repository/API/cache, plus interaction handlers, navigation/route args, visibility/permission/feature-flag conditions, and side effects. Mark every hop `confirmed` or `inferred`.
8. Report using the output template in the `analyze-screen-logic` skill: conclusion, screen evidence, screen map, entry & UI implementation, state & data flow, interaction & navigation, conditions & side effects, uncertainties, next steps. Do not paste whole files.
9. Do not modify code. For one control, switch to `locate-ui-code`; for observation only, `inspect-current-screen`; for before/after checks, `verify-ui-change`.