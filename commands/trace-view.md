---
description: Trace one control on screen back to its wiring — implementing class, click handler, visibility control, and where its text/image/background is set
argument-hint: <control text/id/ref, e.g. "关注" button>
---

# Trace one view's wiring

`$ARGUMENTS` identifies the control on the current screen: its text, content description, resource id, or `ref`.

Follow the `trace-view-wiring` skill.

- Capture first, then search source. A control absent from the capture is "not on this screen", not "not in the repository".
- Answer the four wiring questions the user asked — implementation, events, visibility, content — and leave the others out.
- Every claim carries `file:line`; anything traced by naming or navigation only is marked `inferred`.

Gate: no Android project, no Android module, and no explicit Android mention → call no tool. Details in the `trace-view-wiring` skill.