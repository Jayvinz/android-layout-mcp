---
description: Summarize the current Android screen and its visible entry points (natural-language requests route through the inspect-current-screen skill)
argument-hint: [optional package name]
---

# Current screen context

Package hint: $ARGUMENTS

Follow the `inspect-current-screen` skill.

Use the layout-inspector-android MCP tools (or the bundled CLI if MCP is unavailable):

1. `get_state` (with `package` if provided): device, screen, foreground package/activity, pids, windows.
2. `dump_ui(source="auto", format="tree", visibleOnly=true)`: compact visible tree; report `uiKind`.
3. If the tree is large or Compose-heavy, summarize the top 2-3 levels plus the clickable/visible leaf labels. Do not paste hundreds of lines.
4. If the user is asking "what page is this", identify the most likely Activity/Fragment/route name and the visible top-level sections. If the package does not match the repo's applicationId, say so.
5. Only call `screenshot` when the user asks for visual confirmation or the tree is ambiguous. If used, include the image-to-device coordinate mapping.
6. End with a short list of visible entry points (label, id, bounds/center, clickable) that the user can ask about next.
7. Do not scan the repository or call `locate_code` unless the user explicitly asks where the screen or a control is implemented.
