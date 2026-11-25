---
name: audit-ui
description: >-
  Android-only. Use when the user asks to audit a screen or a block of it for layout and accessibility problems AND wants to know where the offending code lives: overlaps, clipping, small touch targets, invisible clickable areas, duplicate ids, deep nesting, overdraw, hardcoded left/right that breaks RTL. Triggers include "审查布局问题", "这块 UI 有没有问题", "有没有重叠", "有没有小点击区域", "有没有被裁剪", "布局有没有问题", "层级嵌套太深", "过度绘制", "RTL 有没有问题", "audit this UI and the code behind it", "check this screen for layout problems and find the source". Owns: defect judgments on one screen or one block, each tied to its layout XML or Composable. Not: what is on the screen (capture-ui), property values of one control (inspect-view-attribute), one control's wiring (trace-view-wiring). Only in Android projects; in a non-Android repository use only when the user explicitly mentions Android.
---

# Auditing UI Defects Against Their Source

Audit one screen or one block, then **trace every defect back to the layout XML or Composable that causes it.** A finding without a code location is only half the answer: the user cannot fix "something overlaps" without knowing which file to open.

Core principle: **the rule hit supplies evidence, the source supplies the fix location, and neither alone is the answer.**

## Scope

| The user asks | Go to |
|---|---|
| What is on this screen | `capture-ui` |
| One control's margins, padding, measured size | `inspect-view-attribute` |
| One control: implementation, click, visibility, content | `trace-view-wiring` |
| One block's UI → ViewModel → data chain | `trace-ui-to-logic` |

This skill judges **defects** and maps them to code. It does not trace one control's behaviour, and it does not explain a block's data flow.

## Step 0 — Android project gate

Look for an Android project in the cwd or any parent: `settings.gradle(.kts)`, `gradlew(.bat)`, a module `build.gradle(.kts)` applying `com.android.*`, or `AndroidManifest.xml`. Skip `node_modules/`, `build/`, `.gradle/`.

| Workspace | User asked about | Allowed |
|---|---|---|
| Android project | anything | everything |
| Not Android | a device screen/page, or mentioned Android | observation only — no `locate_code` |
| Not Android | anything else | **no tool at all** |

**HARD STOP** on the third row: call nothing, reply in one sentence that this workspace is not an Android project, then offer device observation or ask for the Android module path. A bare "这个按钮/这个页面/这个弹窗" is not an explicit device request, and a connected device does not make the repository Android.

Mapping a defect to source needs an Android module. If the user mentions Android but no module is present, report the defects without source locations and say the module path is needed.

## Step 1 — Capture and scope

`get_state`, then `analyze_ui(source="auto")` over the whole screen.

**The default target is the current screen. A block becomes the target only when the user names one** ("这块", "这个列表", "顶部这一栏", "this card group"). When they name a block:

1. Locate it in the captured tree with `find_elements` (by text/id) or `hit_test` for a point.
2. Take that node's subtree as the audit boundary: every descendant, nothing outside it.
3. Filter the rule results to nodes inside that subtree — a finding outside the block is not part of this audit.

Say which boundary you used. Auditing the whole screen when the user asked about one card produces noise and buries the answer.

## Step 2 — Judge

Run the full rule set unless the user names specific rules.

| Rule | Flags | Severity |
|---|---|---|
| `small_touch_target` | clickable area below 48dp | warning |
| `overlap` | sibling clickables whose bounds intersect | warning |
| `clipped` | child cut off by an ancestor or the screen | info |
| `outside_parent` | node outside a non-scrollable parent | warning |
| `offscreen` | visible node entirely off-screen | warning |
| `invisible_clickable` | clickable but not visible | warning |
| `zero_size` | visible-flagged node with zero size | warning |
| `unlabeled_clickable` | clickable with no text/desc/id | info |
| `duplicate_id` | the same resource id on several nodes | warning |
| `deep_nesting` | depth beyond the threshold | info |
| `overdraw` | nested opaque backgrounds over the same area | info |
| `rtl_issues` | hardcoded left/right where start/end mirrors | warning |

Drop the expected hits before reporting: scrollable content beyond the viewport, system-bar backgrounds, Compose structural depth.

## Step 3 — Tie each defect to its source

This is what makes the audit actionable. For every finding you keep, resolve the node to code:

1. Collect the node's `resourceId`, class, and parent chain from the tree.
2. Call `locate_code` with the anchors the node actually has — `id` for an XML id, `text`/`desc` for a label, `composeName`/`composeFile`/`composeLine` when `uiKind` is `compose`. Pass only what exists; a fabricated anchor yields a fabricated file.
3. Read the top candidates and identify the layout element or Composable that owns the node. For XML that is the tag carrying `app:id/...`; for Compose it is the composable and its `Modifier` chain.
4. State the **fix**, not just the location: `layout_marginLeft` → `layout_marginStart`; a 32dp button → `minWidth`/`minHeight` 48dp; an overlapping pair → which sibling should yield; deep nesting → the wrapper that can go.

When `uiKind` is `compose` and the Composable `file:line` is needed, add `dump_ui(source="compose", maxNodes=2000)`. It takes 8–12s and needs a debuggable build, so skip it when the XML id already resolves.

If a defect cannot be tied to source within 1–2 hops, say so and leave the location blank. An honest gap beats a guessed file.

## Step 4 — Answer

```markdown
## Verdict
<Clean | N defects in <the whole screen | the named block> (x error, y warning, z info)>

## Defects and their source
| Severity | Rule | Node | Evidence | Source | Fix |
|---|---|---|---|---|---|
| error | invisible_clickable | `d12` `MaterialButton` id=`submit` | clickable, visible=false | `app/src/main/res/layout/fragment_form.xml:42` | remove the `visibility=gone` set at `FormFragment.kt:88` |
| warning | small_touch_target | `s24` `ImageButton` id=`close` | 32x32 dp | `layout/item_card.xml:18` | set `minWidth`/`minHeight` to 48dp |
| warning | rtl_issues | `d31` `TextView` | `layout_marginLeft=16`, no start | `layout/row.xml:22` | `layout_marginLeft` → `layout_marginStart` |

## Not reported
- <rule>: <scrollable / system UI / Compose structural>

## Unresolved
- <defect>: <why the source could not be found in 1–2 hops>
```

## Quality rules

- Report only rules the tool returned; the rule table is the contract.
- Every row needs a node ref, the offending value, and — when a module is present — a `file:line`.
- Never invent a source location. If `locate_code` returns no confident candidate, move the finding to `Unresolved`.
- A rule hit is not automatically a bug: state which hits are expected for this screen type.
- Do not edit code. Give the location and the fix as text; the user applies it.
- Refs are valid for one capture; re-capture before a follow-up on a changed screen.