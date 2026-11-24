---
description: Analyze the code, state, data flow, and business logic behind the current Android screen, dialog, or bottom sheet
argument-hint: [optional screen/dialog description or package name]
---

# Analyze current screen or dialog logic

Context: $ARGUMENTS

Follow the `analyze-screen-logic` skill. This is read-only: do not edit code.

## Step 0 — Android project gate

Apply the gate from the `analyze-screen-logic` skill: `settings.gradle(.kts)`, `gradlew(.bat)`, a module `build.gradle(.kts)` applying `com.android.*`, or `AndroidManifest.xml`. A connected device does not make the repository Android.

**HARD STOP:** with no marker, and no explicit device/screen request or Android mention, call no tool. Say the workspace is not an Android project and ask for the Android module path. "这个按钮/这个页面/这个弹窗" alone is not an explicit device request.

## Procedure

Run the `analyze-screen-logic` workflow: `get_state` → `dump_ui(source="auto", format="tree", visibleOnly=true)` → scope the surface → resolve the owner → `locate_code` per section → follow state/data 1–3 hops → report from the skill's output template.

Command-specific notes:

- If a dialog, bottom sheet, or overlay is in a separate window, dump that window with `dump_ui(source="view", window="<index-or-name>")`; a Compose dialog may share the Activity window.
- On Compose screens add `dump_ui(source="compose", maxNodes=2000)` only when Composable `file:line` is needed.
- Read the candidates to confirm; a score is not proof. Do not paste whole files and do not modify code.