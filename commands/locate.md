---
description: Locate a control on the current Android screen and trace it to Compose/XML source code and business logic
argument-hint: <element text/description/id, e.g. "Me" button>
---

# Locate UI element in code

Target element: $ARGUMENTS

Follow the `locate-ui-code` skill. Required behaviour:

## Step 0 — Android project gate

Apply the gate from the `locate-ui-code` skill: `settings.gradle(.kts)`, `gradlew(.bat)`, a module `build.gradle(.kts)` applying `com.android.*`, or `AndroidManifest.xml`. A connected device does not make the repository Android.

**HARD STOP:** with no marker, and no explicit device/screen request or Android mention, call no tool. Say the workspace is not an Android project and ask for the Android module path. "这个按钮/这个页面/这个弹窗" alone is not an explicit device request.

Run the `locate-ui-code` workflow for the element named in `$ARGUMENTS`: `get_state` → `dump_ui(source="auto", format="tree", visibleOnly=true)` → find the node → `locate_code` → read the top candidates. Add `dump_ui(source="compose", maxNodes=2000)` when `uiKind` is `compose`.

Command-specific notes:

- State the package and page in the answer.
- If several nodes match, list them with bounds/id/class and ask which one; do not guess.
- Answer with the structure from `references/output-template.md` in the `locate-ui-code` skill. Do not modify any code.
