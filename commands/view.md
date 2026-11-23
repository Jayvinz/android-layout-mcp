---
description: Open an interactive HTML viewer of the current Android screen in the browser
argument-hint: [optional package name]
---

# Interactive UI viewer

Package hint: $ARGUMENTS

Follow the `inspect-current-screen` skill. Act only on this explicit visual request.

## Step 0 — Android project gate

Confirm the working directory (or the repo root the user named) is an Android project: `settings.gradle(.kts)`, `gradlew(.bat)`, a module `build.gradle(.kts)` applying `com.android.*`, or `AndroidManifest.xml`.

If none:
- continue only when the user explicitly asked to inspect the device screen/page or explicitly mentioned Android;
- otherwise stop, say this plugin targets Android projects, and never scan the repository or call `open_viewer`.

A connected device does not make the repository Android.

**HARD STOP:** if no Android marker exists and the user did not explicitly ask to inspect a connected device screen/page and did not explicitly mention Android, do NOT call `open_viewer`, `get_state`, `dump_ui`, `find_elements`, `locate_code`, or any other tool. Say the workspace is not an Android project; offer device observation or ask for the Android module path. A reference like "这个页面/这个弹窗" alone is not an explicit device request.

1. Call MCP `open_viewer` (with `package` if provided). It captures the current UI once, writes a self-contained offline HTML file, and opens it in the default browser.
2. If MCP is unavailable, run the CLI fallback:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" view --package "<package>"
   ```
3. Report the absolute file path and whether the browser opened (`opened`, or `openError` when it did not). Mention screenshot availability and whether the tree was truncated.
4. The viewer is a static snapshot: refs are valid only for that capture, there is no live refresh, and the file contains device/screen data. Keep it under `.dli/` and never commit it.
5. Do not modify code, do not call `locate_code`, and do not open a browser for ordinary summary/dump/screenshot requests.