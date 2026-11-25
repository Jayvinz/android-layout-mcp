---
description: Read one View's layout and style attributes — margins, padding, measured size, text metrics, background, RTL
argument-hint: <View text/id/ref, e.g. "登录" button>
---

# Inspect one view's attributes

`$ARGUMENTS` identifies the View: its visible text, content description, resource id, or the `ref` from a prior capture.

Follow the `inspect-view-attribute` skill.

- Use `dump_ui(source="view", includeProperties=true)` — only that combination carries `view.properties`.
- Quote the raw attribute name next to each value, and convert px to dp with the screen density.
- Report `-1` / `-2` layout params as MATCH_PARENT / WRAP_CONTENT, and `Integer.MIN_VALUE` margins as "not set".

Gate: no Android project and no explicit device/screen request → call no tool. Details in the `inspect-view-attribute` skill.