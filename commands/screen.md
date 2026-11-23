---
description: Summarize the current Android screen and its visible entry points (natural-language requests route through the inspect-current-screen skill)
argument-hint: [optional package name]
---

# Current screen context

Package hint: $ARGUMENTS

Follow the `inspect-current-screen` skill.

## Step 0 — Android project gate

Confirm the working directory (or the repo root the user named) is an Android project: `settings.gradle(.kts)`, `gradlew(.bat)`, a module `build.gradle(.kts)` applying `com.android.*`, or `AndroidManifest.xml`.

If none:
- continue only when the user explicitly asked to inspect the device screen/page or explicitly mentioned Android;
- otherwise stop, say this plugin targets Android projects, and never scan the repository or call `locate_code`.

A connected device does not make the repository Android.

**HARD STOP:** if no Android marker exists and the user did not explicitly ask to inspect a connected device screen/page and did not explicitly mention Android, do NOT call `get_state`, `dump_ui`, `find_elements`, `locate_code`, `open_viewer`, or any other tool. Say the workspace is not an Android project; offer device observation or ask for the Android module path. A reference like "这个按钮/这个页面/这个弹窗" alone is not an explicit device request.

Use the layout-inspector-android MCP tools (or the bundled CLI if MCP is unavailable):

1. `get_state` (with `package` if provided): device, screen, foreground package/activity, pids, windows.
2. `dump_ui(source="auto", format="tree", visibleOnly=true)`: compact visible tree; report `uiKind`.
3. If the tree is large or Compose-heavy, summarize the top 2-3 levels plus the clickable/visible leaf labels. Do not paste hundreds of lines.
4. If the user is asking "what page is this", identify the most likely Activity/Fragment/route name and the visible top-level sections. If the package does not match the repo's applicationId, say so.
5. Only call `screenshot` when the user asks for visual confirmation or the tree is ambiguous. If used, include the image-to-device coordinate mapping.
6. End with a short list of visible entry points (label, id, bounds/center, clickable) that the user can ask about next.
7. Do not scan the repository or call `locate_code` unless the user explicitly asks where the screen or a control is implemented.
