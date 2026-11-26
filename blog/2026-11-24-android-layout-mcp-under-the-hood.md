# Four Android APIs, One Screen Tree: how a capture works

#### Part 2 of two: JDWP, UIAutomator, dumpsys, and the Compose inspector

*This is the second of two posts about [Android Layout MCP](https://github.com/Jayvinz/android-layout-mcp). [Part 1](https://github.com/Jayvinz/android-layout-mcp/blob/main/blog/2026-11-24-android-layout-mcp-getting-started.md) covers installation, capture, and source tracing.*

![Four source cards — view over JDWP, semantics over uiautomator, dumpsys, and compose over JVMTI — each listing what it returns, what it requires, and its cost, feeding one normalized UiNode record. Below, a sample tree shows the same provenance tags on real nodes, and a side note gives measured node counts for one Compose screen.](images/p2-fig1-four-sources.png)

*The four paths do not compete; each answers a different subset of "what is on this screen".*

Android has no single API that answers "what is on this screen". The view hierarchy knows classes, padding, and resource ids. The accessibility tree knows what a screen reader would announce. `dumpsys activity` prints a hierarchy and the Fragment records. The [Compose](https://developer.android.com/develop/ui/compose) inspector knows composable names and source lines, provided [Android Studio](https://developer.android.com/studio) is running.

[Android Layout MCP](https://github.com/Jayvinz/android-layout-mcp) uses all four and normalizes them into one node tree with short refs. This post follows each path, shows where the raw data changes shape, and ends with the parts the tree cannot see.

### One question, four APIs

Each source answers a different subset of the question, at a different cost:

| Source | Returns | Requires | Speed |
|---|---|---|---|
| `view` over JDWP | Full View classes, layout params, padding, margins, visibility | A debuggable app | ~100 ms |
| `semantics` over uiautomator | Text, content descriptions, clickable bounds | Nothing | ~0.5–3 s |
| `dumpsys activity` | Real View classes, ids, bounds, Activity and Fragment records | Nothing | ~100–300 ms |
| `compose` over JVMTI | Composable names, `file:line`, bounds, parameters, recompose counts | Debuggable app, local Android Studio, Java | ~8–12 s |

The gap is easiest to see in the repository's captured fixtures (API 33). A traditional XML screen yields 20 nodes from the view source and 18 from accessibility, where class names degrade to roles such as `Button` and `ViewGroup`. A Compose screen flips it: 10 View nodes, because the dump stops at `AndroidComposeView`; 49 accessibility nodes that carry the text; and 489 Composable nodes from the Compose inspector.

### The view tree over JDWP

The path starts with the process id and a port forward:

```bash
adb shell pidof com.example.app
adb forward tcp:0 jdwp:12345
```

The socket must complete the [`JDWP-Handshake`](https://docs.oracle.com/javase/8/docs/technotes/guides/jpda/jdwp-spec.html) exchange before any command. After that the client sends DDMS chunks in command set `0xC7`. `VULW` lists windows; `VURT` dumps one of them.

`VURT` takes a small binary payload, and every field matters:

```ts
const payload = Buffer.concat([
  int32(1),                 // VURT_DUMP_HIERARCHY
  int32(windowName.length),
  utf16be(windowName),
  int32(0),                 // skipChildren = false
  int32(1),                 // includeProperties = true
  int32(1),                 // use the v2 binary protocol
]);
```

The reply is the buffer produced by [`android.view.ViewDebug.dumpv2`](https://cs.android.com/android/platform/superproject/main/+/main:frameworks/base/core/java/android/view/ViewDebug.java). The client resumes the VM after the handshake, so the app keeps rendering while the tree is read.

`VULW` returns windows in creation order, which is not the order a user sees. With a translucent activity or a dialog on top, the first entry can be the invisible window behind it. The tool resolves the focused component from `mCurrentFocus` and sorts that window first. Capturing all of them is opt-in: `window=all` dumps every window the process reports, marks the focused one as `selected`, and shares one node budget across the result.

![A four-part sequence diagram across three lanes: the client, the app process, and android.view.ViewDebug. Step one is the handshake; step two is VULW listing windows with the reply arriving in creation order; step three is the VURT payload and the dumpv2 call; step four is the tagged-value reply decoded on the client.](images/p2-fig2-jdwp-sequence.png)

*Four exchanges, one of which is the whole point: the app walks its own hierarchy on request.*

#### Decoding dumpv2

The reply is a stream of tagged values: `Z` for boolean, `B`, `S`, `I`, `J`, `F`, `D` for numbers, `R` for strings, and `M` for maps, with a zero key closing each map. Child views appear as `meta:__child__0`, `meta:__child__1`, and so on.

The last map is not a view. It is the property-name table, and the earlier maps store property keys as integers that index into it:

```ts
const table = maps[maps.length - 1];
const viewMaps = maps.slice(0, -1);
const propertyNames = new Map<number, string>();
for (const [key, value] of table.entries) {
  if (typeof value === "string") propertyNames.set(key, value);
}
```

That indirection keeps a dump of several hundred views small, and it is where Android version drift shows up: API 33 emits `layout:left`, `misc:visibility`, and `drawing:translationX`, while older dumps and custom Views use `mLeft`, `mVisibility`, and `mTranslationX`. The decoder keeps an alias list per property instead of hardcoding one spelling.

#### Coordinates, clipping, and refs

A View's `left` and `top` are relative to its parent, and parents scroll and translate. One walk accumulates absolute coordinates and tracks the clip rectangle:

```ts
const absX = parentAbsX + details.left - parentScrollX + details.translationX;
const absY = parentAbsY + details.top - parentScrollY + details.translationY;

node.visibleBounds = visible && clip ? intersect(raw, clip) : null;
const childClip = details.clipChildren && clip ? intersect(clip, raw) : clip;
```

`visibleBounds` is the part of a node that survives ancestor clipping. The analyzer measures touch targets from it, and the screenshot overlay draws it as the node box. A node clipped away entirely keeps its raw `bounds` and gets `visibleBounds: null`, which says something different from "the view is gone".

Refs (`v0`, `v1`, and so on) are assigned during the same walk. They are short because an agent passes them between tool calls, and disposable because the next capture renumbers them.

![Three nested containers and three nodes. A DecorView contains a scrolling View, whose clip rectangle is drawn across the lower half. One node sits entirely above the clip and reports null, one straddles the edge and reports a cropped rectangle, one sits fully inside and reports bounds equal to visibleBounds. The walk formula is printed below.](images/p2-fig3-coords-clip.png)

*Same walk, three outcomes: clipped away, partially visible, fully visible. This is why `visibleBounds` exists as a second field.*

### The accessibility tree

`adb shell uiautomator dump` writes XML with `text`, `content-desc`, `resource-id`, `class`, `clickable`, `enabled`, `checked`, and `bounds` per node. This is the tree that [accessibility services](https://developer.android.com/guide/topics/ui/accessibility) consume, and it is the only content source that needs no debuggable build.

It also merges nodes. A row with a label and an icon can arrive as one clickable node whose text comes from a descendant, and a Compose `testTag` stays invisible unless the app enables [`testTagsAsResourceId`](https://developer.android.com/develop/ui/compose/testing#test_tags). When locator stability matters, a content description survives more refactors than a text label.

**Note**: some ROMs report an accessibility window shorter than the physical screen, which clips nodes at the bottom. The analyzer skips touch-target checks for those nodes instead of reporting false positives.

### The Compose tree

This path borrows Android Studio's own tooling. The tool locates a Studio installation from `--studio`, `ALM_ANDROID_STUDIO`, a running process, or the default install paths; reads its build number; fetches the Compose inspector jar for the app's Compose version from Google Maven (1.8.3 unless you override it); and caches the jar plus a helper compiled against that exact Studio build under `~/.cache/android-layout/`.

On the device it stages five artifacts: the gRPC `transport` binary, the JVMTI agent library, `perfa.jar`, the View inspector jar, and the Compose inspector jar. `run-as` copies the two jars into the app's `code_cache`, and the daemon starts with a hand-encoded protobuf config, since the project carries no protobuf runtime. It stays resident in `/data/local/tmp/alm-compose`, so later captures skip the startup cost.

The capture asks the View inspector for the root view id only and disables inspector screenshots. Leaving them on forces an SKP capture with a 78 MB peak on a 256 MB heap, which OOMs the app. What comes back is the data no other source has: `CommunityActivity.kt:85`, composable names, parameter text, and recompose counts.

The cost is why `compose` is opt-in: 8 to 12 seconds per capture, API 29 or newer, a local Android Studio, and device state that outlives the command until `android-layout compose-clean` runs.

![A two-column staging diagram. The host locates Android Studio, fetches the inspector jar from Google Maven, compiles a helper against that exact build, and caches both under ~/.cache/android-layout. The device side shows five staged artifacts and the two jars copied into the app's code_cache, plus a note that the daemon stays resident between captures.](images/p2-fig4-device-staging.png)

*What is prepared once, what is pushed, and what survives the command.*

### Release builds and dumpsys

Release builds have no debugger, so the fourth path comes from the ActivityManager. `dumpsys activity <package>` prints an indented `View Hierarchy` with real View classes, resource ids, absolute window bounds, and a positional flag string, plus the `Active Fragments` records with lifecycle state.

Fragments are unique to this source. A release build with obfuscated class names still prints a tag and a container id, which is enough to identify the Fragment behind a page.

The gap is text: a `TextView{...}` line has no `mText`. `--source dumpsys` therefore captures the semantics tree as well and joins the two by geometry. The offset between window and screen coordinates varies across devices, so the merge measures it from the trees (the median top delta of text nodes, bounded to 10% of the screen height) and joins only unique matches whose classes belong to the same family. A `TextView` can receive text from a `MaterialTextView`; an `ImageView` cannot.

![Two source panels at the top, dumpsys on the left listing real View classes with no text and semantics on the right carrying text with weaker classes. A pill between them describes the geometric join. Below, a before-and-after pair shows a lone class-and-id node becoming a node with a label, followed by three cards stating the join rules: unique match only, same class family, measured offset.](images/p2-fig5-dumpsys-merge.png)

*Release builds give up text, so the fourth path borrows it — but only when the rectangle and the class family both agree.*

### Choosing a source

`auto` starts from the view tree and classifies the screen before anything else happens. A `ComposeView` or `AndroidComposeView` decides whether Compose is present; a second pass asks whether any non-Compose node carries text, a content description, a click action, a non-system resource id, or a leaf widget class:

```ts
const hasCompose = nodes.some((node) => /ComposeView|AndroidComposeView/.test(node.className));
if (!hasCompose) return "xml";

const hasXmlContent = nodes.some((node) => {
  if (/ComposeView|AndroidComposeView/.test(node.className)) return false;
  if (node.className.startsWith("androidx.compose.")) return false;
  if (node.text || node.contentDescription || node.clickable) return true;
  if (node.resourceId && !SYSTEM_IDS.test(node.resourceId)) return true;
  return XML_LEAF_CLASS.test(node.className);
});
return hasXmlContent ? "mixed" : "compose";
```

The result is `xml`, `compose`, `mixed`, or `unknown`. Pure XML screens use the view tree. Pure Compose screens use accessibility, which needs no debug build and already carries the text. Mixed screens keep both trees and search both.

![A decision tree. The entry point is --source auto, which starts from the view tree. Question one asks whether any node is a ComposeView or AndroidComposeView; no means xml, yes leads to a second question about whether a non-Compose node carries real content, which decides mixed or compose. A table below lists each result with its primary tree, the reason, and the fallback when the primary fails.](images/p2-fig6-source-choice.png)

*Classification runs before the capture is returned, so the payload always states which path produced its numbers.*

Why not use the Compose tree every time, since it knows the most? It needs a debug build, a local Studio, Java 17+, API 29+, and eight to twelve seconds. Most questions about labels, bounds, and clickability are answered in about a second.

Two behaviors matter when a capture fails. If a tree fails, `auto` records a warning and uses the other one; an explicit `--source view` fails instead. A capture that races a window transition is retried once after 300 ms, while a JDWP attach failure is not retried, since each attempt spends its own ten-second connect timeout.

The stability probe is newer. `settle=true` samples the app's frame counter from `dumpsys gfxinfo` every 250 ms before capturing and reports one of three outcomes:

```json
"stability": {
  "stable": false,
  "reason": "timeout",
  "waitedMs": 3094,
  "framesPerInterval": 20,
  "measuredIntervalMs": 328
}
```

Two quiet intervals mean `stable: yes`, and the JSON field says `true`. A ROM or process without the counter reports `stable: unknown`, and the JSON says `null`. Anything else means the UI was still producing frames, so the bounds describe a moment in an animation. Naming the node that keeps invalidating would require `UiAutomation.waitForIdle` inside the app process, which means installing an instrumentation APK; the frame counter is the approximation that needs no install.

### From tree to answer

Hit testing collects every node whose visible bounds contain the point, then sorts by visible area ascending, depth, and draw order, so the smallest element wins. Search matches text, content description, resource id, class, and ref, with `contains`, `exact`, and `/regex/` modes over the primary tree or both trees.

Analysis runs twelve rules: small touch targets, sibling overlap, clipping, children outside a non-scrollable parent, offscreen views, invisible clickables, zero sizes, unlabeled clickables, duplicate ids, deep nesting, overdraw, and RTL mirroring gaps. `deep_nesting` is skipped on the Compose source, where wrapper depth is an artifact of the framework, and the two property-based rules request raw View properties by default.

![Twelve rules in four columns by the evidence they read: geometry (zero size, offscreen, small touch target, outside parent), visibility (clipped, invisible clickable, overlap), identity (unlabeled clickable, duplicate id, deep nesting), and raw View properties (overdraw, RTL issues). Each row carries its severity. Two notes follow: deep nesting is skipped on the Compose source, and the raw-property group reports itself as skipped under --no-props.](images/p2-fig7-rules.png)

*Four kinds of evidence, one list of rules. The last column is why a capture sometimes has to ask for the debug dump.*

Projection is what keeps large screens affordable. `format=compact` drops nodes that neither say nor do anything, promotes the children of dropped containers, and reports how many nodes survived. The full tree stays in `format=json`, and `analyze` always runs on the full tree because the rules need it.

### What the design costs

Four sources mean four sets of prerequisites. Captures carry warnings, a `sources` array, and the stability object when you asked for it. Refs expire with the snapshot. `compose` needs a local Android Studio and leaves a daemon behind. Content drawn to a canvas, a `SurfaceView`, or inside a `WebView` has no text to find in any tree.

The next time an agent tells you a button sits at `(540, 2239)`, the payload also says which path produced that number, whether the screen was still moving, and what the capture could not see.

Part 1 has the install steps and the everyday commands: [Give Your Coding Agent a Live View of the Android Screen](https://github.com/Jayvinz/android-layout-mcp/blob/main/blog/2026-11-24-android-layout-mcp-getting-started.md).

*The code snippets in this post use the project's MIT license:*

```text
// Copyright (c) Jayvinz. SPDX-License-Identifier: MIT
```

**Resources**

- [Repository](https://github.com/Jayvinz/android-layout-mcp)
- [Data sources and measured results](https://github.com/Jayvinz/android-layout-mcp/blob/main/docs/data-sources.md)
- [CLI reference](https://github.com/Jayvinz/android-layout-mcp/blob/main/docs/cli.md)
- [Cross-agent compatibility](https://github.com/Jayvinz/android-layout-mcp/blob/main/docs/cross-agent.md)
- [JDWP specification](https://docs.oracle.com/javase/8/docs/technotes/guides/jpda/jdwp-spec.html)
- [JVMTI specification](https://docs.oracle.com/javase/8/docs/platform/jvmti/jvmti.html)
- [UI Automator](https://developer.android.com/training/testing/other-components/ui-automator)
- [ViewDebug source](https://cs.android.com/android/platform/superproject/main/+/main:frameworks/base/core/java/android/view/ViewDebug.java)

*P.S. Thanks to the people who captured the same screens with all four sources and compared the node counts.*