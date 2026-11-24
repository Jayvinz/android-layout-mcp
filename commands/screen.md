---
description: Summarize the current Android screen and its visible entry points (natural-language requests route through the inspect-current-screen skill)
argument-hint: [optional package name]
---

# Current screen context

Package hint: $ARGUMENTS

Follow the `inspect-current-screen` skill.

## Step 0 — Android project gate

Apply the gate from the `inspect-current-screen` skill: `settings.gradle(.kts)`, `gradlew(.bat)`, a module `build.gradle(.kts)` applying `com.android.*`, or `AndroidManifest.xml`. A connected device does not make the repository Android.

**HARD STOP:** with no marker, and no explicit device/screen request or Android mention, call no tool. Say the workspace is not an Android project and ask for the Android module path. "这个按钮/这个页面/这个弹窗" alone is not an explicit device request.

Run the `inspect-current-screen` workflow: `get_state`, then `dump_ui(source="auto", format="tree", visibleOnly=true)`.

Command-specific notes:

- Pass `package` to `get_state` when `$ARGUMENTS` names one, and report a mismatch with the repo's applicationId.
- If the user asks "what page is this", name the likely Activity/Fragment/route plus the visible top-level sections.
- Do not scan the repository or call `locate_code` unless the user explicitly asks where the screen or a control is implemented.
