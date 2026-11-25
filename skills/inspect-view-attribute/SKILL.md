---
name: inspect-view-attribute
description: >-
  Android-only. Use when the user asks for one View's layout and style attributes to check a UI detail: margins, padding, measured size, text size or color, gravity, background, or RTL handling. Triggers include "这个按钮的边距是多少", "这个控件为什么这么高", "核对一下这个卡片的 padding", "它的 layoutParams 是什么", "这个文案的字号", "背景是什么", "margin / padding of this View", "why is this view this tall", "check this View's attributes". Owns: one View's attribute values, read from the raw View dump. Not: what is on screen and where (capture-ui), where the value is set in code (trace-view-wiring), whether the value is wrong (audit-ui). Only in Android projects; in a non-Android repository use only when the user explicitly mentions Android.
---

# Inspecting One View's Attributes

Read and report the actual numbers behind a View's appearance. Core principle: **quote the raw property, and name it exactly — never estimate a dp from a pixel or guess a margin from a screenshot.**

## Scope

| The user asks | Go to |
|---|---|
| Where is this View, what is it | `capture-ui` |
| Where is this padding set in code | `trace-view-wiring` |
| Is this View too small / overlapping | `audit-ui` |

This skill reports values. It does not judge whether the value is correct.

## Step 0 — Android project gate

Look for an Android project in the cwd or any parent: `settings.gradle(.kts)`, `gradlew(.bat)`, a module `build.gradle(.kts)` applying `com.android.*`, or `AndroidManifest.xml`. Skip `node_modules/`, `build/`, `.gradle/`.

| Workspace | User asked about | Allowed |
|---|---|---|
| Android project | anything | everything |
| Not Android | a device screen/page, or mentioned Android | observation only — no `locate_code` |
| Not Android | anything else | **no tool at all** |

**HARD STOP** on the third row: call nothing, reply in one sentence that this workspace is not an Android project, then offer device observation or ask for the Android module path. A bare "这个按钮/这个页面/这个弹窗" is not an explicit device request, and a connected device does not make the repository Android.

## Step 1 — Find the View

`get_state`, then `dump_ui(source="auto", format="tree", visibleOnly=true)`.

Locate the View with `find_elements` (`by="text"` → `desc` → `id` → `class`) or `hit_test` for a coordinate. Keep its `ref`; every later call reuses it.

If several candidates match, list them with bounds and class, and ask which one — a property report for the wrong node is worse than no report.

## Step 2 — Read the raw properties

```text
dump_ui(source="view", includeProperties=true, format="json")
```

`source="view"` is required: it is the only source that carries `view.properties`. `includeProperties=true` is what makes them appear; without it the normalised fields (bounds, padding summary) are present but the raw key-value map is not.

Pick the node whose `ref` you kept and read `view.properties`. The groups worth reporting:

| Group | Keys | Reports |
|---|---|---|
| Layout | `layout:left/top/right/bottom/width/height` | position inside the parent, actual size |
| Layout params | `layoutParams.width/height` | `-1` = MATCH_PARENT, `-2` = WRAP_CONTENT, else px |
| Margins | `layoutParams.leftMargin/topMargin/rightMargin/bottomMargin`, `startMargin/endMargin` | outer spacing; `-2147483648` means "not set", not a value |
| Padding | `padding:paddingLeft/Right/Top/Bottom`, `userPaddingStart/End` | inner spacing |
| Measurement | `measurement:measuredWidth/Height`, `minWidth/Height` | what the layout actually resolved to |
| Text | `text:textSize`, `scaledTextSize`, `curTextColor`, `text:gravity`, `text:typefaceStyle`, `text:ellipsize` | typography |
| Background | `backgroundDrawableName`, `backgroundFromRes` | what drawable is behind it |
| RTL | `layout:layoutRtl`, `layout:layoutDirection` | whether the node mirrors in RTL |
| Draw | `drawing:elevation`, `drawing:translationX/Y`, `misc:transformation.alpha` | elevation and transforms |

## Step 3 — Convert and caveat

- **px vs dp**: the dump is in device pixels. Divide by `density` from `get_state` and round to one decimal. Say which unit you are quoting; a "66px padding" is meaningless to a designer on another device.
- **MATCH_PARENT / WRAP_CONTENT**: report the semantic, not `-1` / `-2`. A width of `948` with `layoutParams.width = -1` means "match_parent, resolved to 948".
- **Unset margins**: `startMargin` / `endMargin` at `-2147483648` (`Integer.MIN_VALUE`) means the node uses the absolute left/right value instead. Report the absolute one.
- **`scaledTextSize`** is the value after the user's font-scale setting; `textSize` is the raw px. Report both when the user is checking a typography spec.
- Do not derive a color from a screenshot. `curTextColor` is an int like `-1` (white); convert it to `#FFFFFFFF` if the user needs a hex, and say it came from the property, not from pixels.

## Step 4 — Answer

Report a table, then one sentence of interpretation if the user asked "why is it like this".

```markdown
## <View> — <class> [<ref>]

| Property | Value | Notes |
|---|---|---|
| Position | left=66 top=352 right=1014 bottom=484 | inside parent |
| Size | 948 x 132 px (344.7 x 48.0 dp) | width=match_parent, height=wrap_content |
| Margins | top=88 px (32.0 dp); left/right/bottom=0 | |
| Padding | left/right=66 px (24.0 dp); top/bottom=28 px (10.2 dp) | |
| Measured | 948 x 132 px; min 242 x 132 | |
| Text | 33 px (12.0 sp), gravity=center, color=#FFFFFFFF | ellipsize=none |
| Background | RippleDrawable | fromRes=false |
| RTL | layoutRtl=false, layoutDirection=0 (LTR) | |

<One sentence: why the height is what it is, or which value looks off.>
```

## Quality rules

- Report the raw property name next to the value, so the user can grep for it.
- Never fabricate a property that the dump does not contain. If a key is missing, the platform did not emit it — say so.
- If `source="view"` fails, the app is not debuggable. Say the properties are unavailable rather than substituting bounds for them; `dumpsys` has no property map.
- Distinguish "not set" (`Integer.MIN_VALUE`, `null`) from "set to zero".
- Refs are valid for one capture only.
- This skill never modifies code and never judges correctness.