# How Android Layout MCP Reads a Screen: JDWP, UIAutomator, and JVMTI

*Part 2 of two. [Part 1](https://github.com/Jayvinz/android-layout-mcp/blob/main/blog/2026-11-24-android-layout-getting-started.md) covers installation and everyday use.*

*[Figure 1: one screen captured by three sources, merged into a single tree]*

Android has no single API that answers "what is on this screen". There is the View hierarchy, reachable through the debugger; the accessibility tree, exposed by `uiautomator`; and the Compose inspector, which lives inside Android Studio and speaks gRPC. Each returns different data at a different cost.

[Android Layout MCP](https://github.com/Jayvinz/android-layout-mcp) uses all three and normalizes them into one node tree with short refs. This post follows each path, shows where the raw data changes shape, and explains the decisions that keep the output usable by a coding agent.

### Three answers to one question

The View hierarchy is the most detailed source. Every `View` reports its class, resource id, bounds, padding, margins, visibility, and layout params. On a Compose screen it stops at `AndroidComposeView`, which is a container with no children.

The accessibility tree is the cheapest source. `adb shell uiautomator dump` writes an XML file describing what accessibility services see. Compose text, content descriptions, and clickable bounds show up on any app, debug or release. Layout params and custom View classes do not.

The Compose tree reaches inside the composition. It returns Composable names, source file and line, bounds, parameter text, and recomposition counts. Getting it requires a running Android Studio, a debuggable app, and about ten seconds per capture.

### The view tree over JDWP

The path starts with the process id and a port forward:

```bash
adb shell pidof com.example.app
adb forward tcp:0 jdwp:12345
```

A TCP connection to that port must complete the `JDWP-Handshake` exchange, after which the client can send DDMS chunks. Android's view debugging lives in command set `0xC7`, with two chunk types: `VULW` lists windows and `VURT` dumps one window's hierarchy.

`VULW` replies with a count followed by UTF-16BE strings of the form `package/activity`. That is how the tool reports the foreground Activity and finds dialogs and popups in separate windows.

`VURT` takes a small binary payload. The flags matter: skip nothing, include properties, and request version 2 of the encoding.

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

The reply is the buffer produced by [`android.view.ViewDebug.dumpv2`](https://cs.android.com/android/platform/superproject/main/+/main:frameworks/base/core/java/android/view/ViewDebug.java). The client resumes the VM after attaching, so the app keeps rendering while the hierarchy is read.

*[Figure 2: JDWP handshake, the VULW and VURT chunks, and the dumpv2 reply]*

### Decoding dumpv2

The buffer is a stream of tagged values: `Z` boolean, `B` byte, `S` short, `I` int, `J` long, `F` float, `D` double, `R` string, `M` map, and a zero byte that ends a map. Maps nest, and child views appear as `meta:__child__0`, `meta:__child__1`, and so on.

The last map in the stream is not a view. It is the property-name string table: the earlier maps store property keys as integers, and the table maps those integers to names such as `layout:left`. That indirection is why a dump of a few hundred views stays compact.

Property names are also where version differences show up. API 33 emits `layout:left`, `drawing:translationX`, and `misc:visibility`; older dumps and custom Views use names like `mLeft`. The decoder checks a list of aliases per property instead of hardcoding one spelling.

Coordinates need a second pass. A View's `left` and `top` are relative to its parent, and parents scroll and translate. The tool walks the tree once and accumulates:

```ts
const absX = parentAbsX + details.left - parentScrollX + details.translationX;
const absY = parentAbsY + details.top - parentScrollY + details.translationY;
const raw = {
  left: Math.round(absX),
  top: Math.round(absY),
  // ...right and bottom from the measured size
};

node.visibleBounds = visible && clip ? intersect(raw, clip) : null;
const childClip = details.clipChildren && clip ? intersect(clip, raw) : clip;
```

`visibleBounds` is the part of a node that survives ancestor clipping. The analyzer sizes touch targets from it, and the viewer draws it as the node box. A node clipped away entirely has `visibleBounds: null` while its raw `bounds` stay intact.

Refs (`v0`, `v1`, ...) are assigned during the same walk. They are short because agents pass them between tool calls, and disposable because the next capture renumbers them.

### The semantics tree

`uiautomator dump` returns XML with attributes such as `text`, `content-desc`, `resource-id`, `class`, `clickable`, `enabled`, `checked`, and `bounds`. Parsing it is straightforward; deciding what the result means is not. The [UI Automator](https://developer.android.com/training/testing/other-components/ui-automator) documentation describes the same tree that accessibility services consume.

Accessibility nodes are merged. A `Row` with a label and an icon may appear as one clickable node whose text comes from a descendant. Compose's `testTag` is invisible to this tree unless an ancestor enables `testTagsAsResourceId`, which is why the docs suggest relying on content descriptions when locator stability matters.

The upside is reach. The semantics tree works on release builds, on any app, and without Android Studio. It takes roughly half a second to three seconds per capture, depending on the screen.

**Note**: some ROMs report an accessibility window shorter than the physical screen, which clips nodes at the bottom. The analyzer skips touch-target checks for those nodes instead of reporting false positives.

### The Compose tree

This path borrows Android Studio's own tooling. The tool locates a Studio installation (`--studio`, `AUI_ANDROID_STUDIO`, the running process, or default paths), reads its build number, and stages five artifacts on the device: the gRPC `transport` daemon, the [JVMTI](https://docs.oracle.com/javase/8/docs/platform/jvmti/jvmti.html) agent, `perfa.jar`, the View inspector jar, and the Compose inspector jar it fetched for the app's Compose version.

The Compose inspector jar does not come from the Studio install. It is extracted from the `ui-android` AAR on Google Maven for the app's Compose version (1.8.3 by default) and cached under `~/.cache/android-layout/`. The helper jar is compiled on first use against the exact Studio build and compiler version, then cached by a hash of build id, helper source, and compiler version. When no compiler is available, a committed helper jar is used instead.

On the device, `run-as` copies the inspector jars into the app's `code_cache`, and the transport daemon starts with a hand-encoded protobuf config. There is no protobuf runtime in the project; the few messages needed are written as varint fields directly. The helper then drives the View and Compose inspectors over gRPC and prints JSON.

Two deliberate limits reduce the cost. The capture asks for the root view id only and disables inspector screenshots, which would allocate a large SKP buffer; the project notes a 78 MB peak when screenshots are left on. The daemon stays resident in `/data/local/tmp/aui-compose`, so later captures skip startup.

The result carries what the other sources cannot: `CommunityActivity.kt:85`, Composable names, parameter text, and recompose counts. It costs 8 to 12 seconds, needs API 29 or newer, and leaves state on the device until `android-layout compose-clean` runs.

*[Figure 3: Studio artifacts staged on the device, the resident transport daemon, and the helper's gRPC calls]*

### Choosing a source

`auto` decides from the View tree before it captures anything else. It first looks for `ComposeView` or `AndroidComposeView`; if neither exists, the screen is XML. If a Compose container exists, it then asks whether any non-Compose node carries text, a content description, a click action, a non-system resource id, or a leaf widget class. Any hit makes the screen mixed. A shortened version, with the structural container allow-list removed:

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

Pure XML screens use the View tree. Pure Compose screens use semantics, because it needs no debug build and already contains the text. Mixed screens carry both trees, and search plus hit testing query both.

Why not use the Compose tree every time, since it carries the most detail? It needs a debug build, a local Studio, Java 17+, API 29+, and ten seconds. Most questions about labels, bounds, and clickability are answered by semantics in about a second.

When the View capture fails, for example on a release build, `auto` keeps the semantics tree and records a warning. An explicit `--source view` fails instead. The JSON carries a `sources` array, so a later reader can see which trees contributed.

### From tree to answer

Four pieces turn the tree into an answer.

**Hit testing** collects every node whose visible bounds contain the point, sorts by visible area ascending, then by depth, then by draw order. The smallest control wins, which matches what the user meant to point at.

**Search** matches text, content description, resource id, class (fully qualified or short), and ref. `contains` ignores case, `exact` does not, and `/pattern/flags` compiles to a regular expression. Invisible nodes are filtered out by default.

**Analysis** runs ten rules over the normalized tree: small touch targets, sibling overlap, clipping, children outside a non-scrollable parent, offscreen views, invisible clickables, zero sizes, unlabeled clickables, duplicate ids, and deep nesting. `deep_nesting` is skipped for the Compose source, where wrapper depth is an artifact of the framework.

**The viewer** serializes the tree, a downscaled screenshot, node details, and the issues into one HTML file. The embedded JSON has an 8 MB budget. If a capture exceeds it, the viewer drops View properties first, then halves the node budget down to 200, and flags the result as truncated.

Source tracing is a separate pass. `locate_code` reads the repository, extracts string and layout anchors, finds `@Composable` definitions and call sites, follows layout includes, and scores candidates: 100 for a Composable definition matched by name or line, 90 for the file the inspector reported, 80 for an id usage next to a click listener, 78 for the layout that defines the id, 45 for a call site. Build output, generated code, and tests are excluded unless asked for.

### Keeping the agent honest

An agent can activate a device tool in the wrong repository. The plugin uses two mechanisms to prevent that in Claude Code, and a portable version of the same rule in every other client.

Every skill and command body starts with a hard gate on Android project markers. A [`PreToolUse` hook](https://code.claude.com/docs/en/hooks) enforces the same rule at the tool layer: it walks up to ten directories looking for `settings.gradle(.kts)`, `gradlew`, an `AndroidManifest.xml`, or a module build file that applies `com.android.*`. If none exists, it denies `get_state`, `dump_ui`, `find_elements`, `locate_code`, and `open_viewer` unless the latest user message explicitly asks about a device screen or mentions Android.

The hook fails open on internal errors, so a broken gate cannot block a legitimate session. The skills divide work as well: `inspect-current-screen` answers what is on screen and never calls `locate_code`; `trace-view-wiring` traces one control; `trace-ui-to-logic` maps a whole screen or dialog to code and data flow; `verify-ui-change` owns before and after. The split is enforced by skill descriptions and tested, because a skill that does everything is hard for a model to route correctly.

### When the agent is not Claude Code

The hook is a Claude Code feature. Move the same skills into Codex CLI, CodeBuddy, or WorkBuddy and the hard gate disappears; the Android-project rule is left as prose in each skill body. That text stays effective because the files are copied unchanged. Their frontmatter carries only `name` and `description`, the portable subset of the Agent Skills standard, and executable paths resolve through `$AUI_ROOT` instead of `${CLAUDE_PLUGIN_ROOT}`. A sync script writes the same files into `.agents/skills`, `.codebuddy/skills`, or `.workbuddy/skills`, so every agent reads the same gate text without a plugin cache.

The server needs no adaptation at all. It speaks MCP over stdio, and the tool set is identical across clients; a `--client <id>` flag reshapes only the config envelope, from `mcpServers` JSON to Codex TOML, VS Code `servers`, Zed `context_servers`, or Goose YAML. Twenty ids share seven shapes. Four clients were exercised end to end: OpenCode listed all 11 tools, CodeBuddy Code and Codex CLI called `list_devices` and got a real device, and WorkBuddy exposed the tools after a one-time GUI approval. Each stopped in a different place first. OpenCode rejects a loose config, CodeBuddy needs approval for project servers, `codex exec` waits on stdin in a non-interactive shell, and WorkBuddy trusts no server until you enable it in the GUI.

Keeping that matrix honest needs a test that reads the docs. `test/cross-agent-compat.test.ts` takes `MCP_CLIENT_IDS` as its source of truth and checks that all six client tables, the CLI choices, and the config shapes agree with it. Add an id in code without updating the docs and the suite fails. The three other suites cover the config envelopes, the portable skill frontmatter, and byte-identical sync copies. All 114 tests run without a device.

### What the design costs

Three sources mean three sets of prerequisites. Two of them need a debug build, JDWP allows one debugger at a time, Composable-level detail needs a local Android Studio, and a Compose capture takes ten seconds. Release builds get semantics only. Content drawn to a canvas, a `SurfaceView`, or a `WebView` has no text to find. Nothing here monitors the screen continuously; every command is a new snapshot.

Those constraints appear in the output. Captures carry warnings, refs expire with the snapshot, and the JSON says which sources produced the tree. The next time an agent reports that a button sits at `(540, 2239)`, that number came from one of these paths, and the payload names it.

If you want to try it, [Part 1](https://github.com/Jayvinz/android-layout-mcp/blob/main/blog/2026-11-24-android-layout-getting-started.md) has the install steps.

**Resources**

- [Repository](https://github.com/Jayvinz/android-layout-mcp)
- [Data sources and measured results](https://github.com/Jayvinz/android-layout-mcp/blob/main/docs/data-sources.md)
- [CLI reference](https://github.com/Jayvinz/android-layout-mcp/blob/main/docs/cli.md)
- [Cross-agent compatibility](https://github.com/Jayvinz/android-layout-mcp/blob/main/docs/cross-agent.md)
- [JDWP specification](https://docs.oracle.com/javase/8/docs/technotes/guides/jpda/jdwp-spec.html)
- [JVMTI specification](https://docs.oracle.com/javase/8/docs/platform/jvmti/jvmti.html)
- [UI Automator](https://developer.android.com/training/testing/other-components/ui-automator)
- [Android Studio](https://developer.android.com/studio)

*The code snippets in this post use the project's MIT license:*

```text
// Copyright (c) Jayvinz. SPDX-License-Identifier: MIT
```
