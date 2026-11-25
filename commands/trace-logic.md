---
description: Trace one block of the screen from its UI to the state holder and data source behind it
argument-hint: <block to trace, e.g. "the feed list" or "this dialog body">
---

# Trace a block's UI to its logic

`$ARGUMENTS` names the block — a feed list, a card group, a form, a dialog body. When it is empty, ask which block the user means rather than silently tracing the whole screen. `ui2logic` is an alias for this command.

Follow the `trace-ui-to-logic` skill.

- Stop at the block's boundary. A question about one control inside it belongs to `trace-view-wiring`.
- Follow one to three hops: UI → state holder → data source. Mark each hop `confirmed` or `inferred`.
- Repeated rows route through an Adapter or a `LazyColumn` item; that is usually where the data wiring lives.

Gate: no Android project, no Android module, and no explicit Android mention → call no tool. Details in the `trace-ui-to-logic` skill.