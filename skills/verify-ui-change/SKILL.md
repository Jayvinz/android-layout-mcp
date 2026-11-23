---
name: verify-ui-change
description: >-
  Android-only. Use when the user asks to verify that a UI change works on a real device, compare layouts before and after a change, or check a screen for regressions such as misalignment, clipping, overlapping, or unclickable controls. Chinese trigger phrases include "验证这个 UI 改动在真机上有没有生效", "改完了看看生效没", "改好了吗，真机上看一下", "改前改后布局对比", "这次改动有没有回归", "有没有错位/被裁剪/点不到", "真机验证 UI 改动". Applies to Android XML and Compose screens after the build has been installed. Only in Android projects; in a non-Android repository use only when the user explicitly asks to verify the device screen or explicitly mentions Android. Do not use for a first-time screen summary or a control inspection without a before/after intent (use inspect-current-screen), or for whole-screen code/business analysis (use analyze-screen-logic).
---

# Verifying UI Changes on a Device

Verify with the real layout tree on the device, not just code or screenshots. The core loop is: **keep a baseline before the change, capture a snapshot after, then run diff + rule checks + visual confirmation.**

## Step 0 — Android project gate

Confirm the working directory (or the repo root the user named) is an Android project. Check the cwd and walk up parent directories:
`settings.gradle(.kts)`, `gradlew(.bat)`, a module `build.gradle(.kts)` applying `com.android.*`, or `AndroidManifest.xml`. Skip `node_modules/`, `build/`, and `.gradle/`.

**HARD STOP:** if no marker exists and the user did not explicitly ask to inspect a connected device screen/page and did not explicitly mention Android, do NOT call `get_state`, `dump_ui`, `find_elements`, `locate_code`, or any other tool. Reply in one sentence: this workspace is not an Android project, so source tracing is unavailable; offer to inspect a connected device screen if they want, or ask for the Android module path.

A reference like "这个按钮/这个页面/这个弹窗" alone is not an explicit device request. A connected device does not make the repository Android.

If the user explicitly asks about a connected device screen/page but no Android marker exists: observation is allowed (`get_state`/`dump_ui`/`find_elements`), but source analysis is unavailable — do not call `locate_code` until the user points at an Android module. If the user only mentions Android without an Android module present, say the module path is still needed and do not scan.


## Prerequisites

- The target app is installed and in the foreground; the package matches this build.
- MCP `layout-inspector-android` is available. If not, fall back to:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" dump --json --out before.json
  node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" diff before.json after.json
  ```
- If the user has already changed the code and reinstalled without a baseline, do not fabricate a "before". Verify against the expected state using `analyze_ui`, screenshots, and assertions on key nodes, and state clearly that no baseline exists.

## Step 1 — Establish a baseline (before the change)

Before modifying code or rebuilding:

```text
dump_ui(source="auto", savePath=".dli/before.json", format="json")
```

- Save under `.dli/` inside the repository (create it if needed) and remind the user that the file may contain device information and must not be committed.
- Also record from `get_state`: package, Activity, screen size/density, and `uiKind`.
- If the change affects a scrollable page, scroll to the target area before dumping; otherwise before/after may not show the same screen.
- If the page animates or loads asynchronously, wait for it to settle first (use `screenshot` to confirm).

## Step 2 — Capture after the change

Rebuild, reinstall, and return to the same page and scroll position:

```text
dump_ui(source="auto", savePath=".dli/after.json", format="json")
```

- `uiKind` must match the baseline. If it changes from `xml` to `mixed`/`compose`, the structure changed fundamentally and the diff may not be comparable.
- The `source` of both dumps should match. Mixed screens automatically include view + semantics; if they differ, explicitly pass `source="both"` or `source="view"`.

## Step 3 — Structured comparison

```text
diff_ui(beforePath=".dli/before.json", afterPath=".dli/after.json")
```

- Focus on `added` / `removed` / `changed` and the `text` summary.
- For each change, decide whether it is expected (this change) or a regression (collateral damage to other nodes).
- Layout shifts are not always bugs: longer copy, font scaling, and safe-area changes can legitimately move things.
- If `diff_ui` reports incompatible sources, re-capture the same `source` with `dump_ui`.

## Step 4 — Rule checks

```text
analyze_ui(source="auto")
```

Key rules:

- `small_touch_target`: clickable area below 48dp.
- `overlap`: sibling clickable elements overlap.
- `clipped` / `outside_parent`: clipped or outside the parent (excluding scrollable content).
- `invisible_clickable`: invisible but still clickable.
- `unlabeled_clickable`: a clickable area with no text/description/id.
- `duplicate_id`: duplicate ids causing binding ambiguity.
- `deep_nesting`: hierarchy too deep.

Report only issues related to this change; do not count pre-existing problems as regressions.

## Step 5 — Visual confirmation

When needed:

```text
screenshot(savePath=".dli/after.png", annotate=true)
```

- The default width is 720px; these are image coordinates, not device coordinates. Use the returned `coordinateMapping`, or `tap(imageX=..., imageY=..., imageWidth=..., imageHeight=...)`.
- `annotate=true` writes an `.annotated.svg` with node boxes, which helps spot misalignment.
- Screenshots are supporting evidence; `dump_ui` / `diff_ui` structured results take precedence.

## Step 6 — Interaction verification

If the change affects clicks or navigation:

1. `find_elements(query="<text/id>", both=true)` to confirm the target is clickable and has reasonable bounds.
2. `tap(ref="<ref>")` or `tap(text="...")`, then `get_state` to confirm the page/Activity changed.
3. Do the same for scroll/input with `swipe` and `input_text`.
4. On failure, inspect the node and coordinates returned by `tap`; do not tap blindly in a loop.

## Output

Answer in the user's language, using this structure:

```markdown
## Verdict
Pass / Regression found / Could not verify (reason)

## Comparison
- Baseline: <package> <Activity> <screen> uiKind=<kind> at <time>
- After: same as above
- Node count: before=<n> after=<n>
- Changes: added <n>, removed <n>, moved/resized <n>

## Expected changes
- <file/node>: ... (as intended)

## Regressions / risks
- <node>: <rule or diff evidence> (file:line if locatable)

## Unverified
- <needs login/specific data/scroll position>

## Recommendations
- <nodes/layouts to fix, or additional verification steps>
```

## Quality rules

- With no baseline, say "no before baseline"; do not substitute "should be unchanged" for verification.
- Diff conclusions must cite node refs/paths or text; "the layout looks fine" is not evidence.
- Separate expected changes from regressions; do not report legitimate copy/safe-area shifts as bugs.
- Do not modify code. When a regression is found, provide locating clues (ref, bounds, likely layout/Composable).
- Remind the user not to commit `.dli/` artifacts.
