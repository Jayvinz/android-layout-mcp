---
description: Locate a control on the current Android screen and trace it to Compose/XML source code and business logic
argument-hint: <element text/description/id, e.g. "我的" button>
---

# Locate UI element in code

Target element: $ARGUMENTS

Follow the `locate-ui-code` skill. Required behaviour:

1. Call `get_state` first to confirm the foreground package, activity, screen size, and pid. State the package and page in the answer.
2. Capture the UI with `dump_ui(source="auto", format="tree", visibleOnly=true)`. Note `uiKind`.
3. If `uiKind` is `compose`, also call `dump_ui(source="compose", maxNodes=2000)` so the element has a `file:line` and Composable name. If it fails, continue with semantics and mark confidence lower.
4. Locate the element with `find_elements` (`both=true`, exact then contains). If several candidates remain, list them with bounds/id/class and ask which one; do not guess.
5. Call MCP `locate_code` (or run the script if MCP is unavailable). Pass only the anchors that exist:
   ```text
   locate_code(root="<repo root>", text=["<text>"], desc=["<description>"], id=["<resourceId>"],
               composeName="<name>", composeFile="<file>", composeLine=<line>,
               className=["<viewClass>"])
   ```
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/locate-code.mjs" --root . \
     --text "<text>" --id "<resourceId>" \
     --compose-name "<name>" --compose-file "<file>" --compose-line <line> \
     --json
   ```
6. Read the top 5-8 candidate files around the reported lines. A score is not proof; confirm by reading.
7. If the user asked for "相关代码逻辑", trace handler -> state -> repository for 1-3 hops, marking each hop `confirmed` or `inferred`.
8. Answer with the structure from the `locate-ui-code` skill's `references/output-template.md`: conclusion, UI evidence, anchors, chain, uncertainty, next files. Do not modify any code.
