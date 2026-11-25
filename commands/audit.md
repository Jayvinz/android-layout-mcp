---
description: Audit a screen or one block of it for layout defects, then tie each one to the layout XML or Composable that causes it
argument-hint: [optional block, e.g. "这个列表" or "the top bar"]
---

# Audit UI defects against their source

`$ARGUMENTS` optionally names the block to audit ("这块", "这个列表", "顶部这一栏"). Empty means audit the current screen.

Follow the `audit-ui` skill.

- Default target is the whole screen; a block is the target only when the user names one. Say which boundary you used.
- For every defect, resolve the node to its layout XML or Composable and state the fix — a finding without a location is half an answer.
- Drop expected hits before reporting: scrollable content beyond the viewport, system-bar backgrounds, Compose nesting depth.
- If a defect cannot be tied to source in 1–2 hops, put it under `Unresolved` rather than guessing a file.

Gate: no Android project and no explicit device/screen request → call no tool. Details in the `audit-ui` skill.