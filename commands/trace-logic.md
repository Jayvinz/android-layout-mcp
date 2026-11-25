---
description: Trace a UI block to the business code and logic behind it — the block is the entry point, the answer is source
argument-hint: <UI block that starts the trace, e.g. "the feed list" or "this dialog body">
---

# Trace a UI block to its business code and logic

`$ARGUMENTS` names the UI block that starts the trace — a feed list, a card group, a form, a dialog body. It is the entry point, not the scope of the answer: the report has to end in the code that builds it and the logic that feeds it. When it is empty, ask which block the user means rather than silently tracing the whole screen. `ui2logic` is an alias for this command.

Follow the `trace-ui-logic` skill.

- Stop at the block's boundary. A question about one element inside it belongs to `trace-view-wiring`.
- Follow one to three hops: UI → state holder → data source. Mark each hop `confirmed` or `inferred`.
- Repeated rows route through an Adapter or a `LazyColumn` item; that is usually where the data wiring lives.

Gate: no Android project, no Android module, and no explicit Android mention → call no tool. Details in the `trace-ui-logic` skill.