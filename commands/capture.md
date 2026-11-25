---
description: Capture the current Android screen or one named block — structure, Activity and uiKind, visible entry points, and saved artifacts
argument-hint: [optional block or package name, e.g. "这个列表" or com.example.app]
---

# Capture the current screen

`$ARGUMENTS` is either a block to scope the capture to ("这块", "这个列表", "顶部这一栏") or a package name. A package name goes to `get_state` and `dump_ui` as `package`; a block name is resolved against the captured tree.

Follow the `capture-ui` skill.

- **Default target is the whole screen. A block is the target only when the user names one** — then report that block's subtree, not the entire screen.
- Report `activity` and `uiKind` explicitly — the two big-dimension facts every follow-up question depends on.
- Save all three artifacts for the screen: `.alm/capture.json`, `.alm/capture.png`, `.alm/capture.xml` (the uiautomator XML is the only one a human can open directly). Say when the report is scoped to a block while the files cover the screen.
- Android Studio's Layout Inspector cannot open these; its `.li` format is private. Say so if the user expects that.

Gate: no Android project and no explicit device/screen request → call no tool. Details in the `capture-ui` skill.