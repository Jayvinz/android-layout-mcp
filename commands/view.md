---
description: Open an interactive HTML viewer of the current Android screen in the browser
argument-hint: [optional package name]
---

# Interactive UI viewer

Package hint: $ARGUMENTS

Follow the `inspect-current-screen` skill. Act only on this explicit visual request.

1. Call MCP `open_viewer` (with `package` if provided). It captures the current UI once, writes a self-contained offline HTML file, and opens it in the default browser.
2. If MCP is unavailable, run the CLI fallback:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" view --package "<package>"
   ```
3. Report the absolute file path and whether the browser opened (`opened`, or `openError` when it did not). Mention screenshot availability and whether the tree was truncated.
4. The viewer is a static snapshot: refs are valid only for that capture, there is no live refresh, and the file contains device/screen data. Keep it under `.dli/` and never commit it.
5. Do not modify code, do not call `locate_code`, and do not open a browser for ordinary summary/dump/screenshot requests.