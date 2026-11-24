# Inspect a Live Android Screen from Claude Code

*Part 1 of two: install the plugin, read the screen, trace a control to source. [Part 2](https://github.com/Jayvinz/android-ui-inspector/blob/main/blog/2026-11-24-android-ui-inspector-under-the-hood.md) opens the implementation.*

*[Figure 1: the plugin's HTML viewer showing the node tree, screenshot overlay, and layout issues]*

Coding agents read repositories well. Ask why a button is disabled and the agent will open the ViewModel, the state holder, the theme, and the click handler. What it cannot do on its own is look at the phone.

[Android UI Inspector](https://github.com/Jayvinz/android-ui-inspector) gives it that view. It is a CLI and an [MCP](https://modelcontextprotocol.io/) server, packaged as a Claude Code plugin, that captures the live screen of a connected device or emulator over [ADB](https://developer.android.com/tools/adb), then answers questions about the screen with structured data instead of pixels.

By the end of this post you will have the plugin installed, a first inspection running, and a visible control traced back to its Compose or XML source. You will also know which screens it cannot read, before you build a workflow on top of it.

### What it does

The tool captures the current screen through up to three data sources and normalizes them into one node tree. The default mode, `auto`, picks per screen: the debug View hierarchy for XML layouts, the accessibility semantics tree for Compose screens, and both for screens that mix the two. The third source, Compose inspection, is opt-in with `--source compose` and talks to Android Studio's Compose inspector for Composable names and `file:line`.

On top of that tree it exposes 14 MCP tools:

- capture and inspection (`list_devices`, `get_state`, `dump_ui`, `find_elements`, `hit_test`)
- interaction (`tap`, `swipe`, `input_text`, `press_key`)
- verification (`analyze_ui` with 10 layout and accessibility rules, `diff_ui`, `screenshot`, `open_viewer`)
- source tracing (`locate_code`)

There is also a self-contained HTML viewer, a suite of 94 tests that runs without a device, and a set of Claude Code skills and slash commands that decide when each capability should run.

Why not let the model read a screenshot instead? Pixels give labels and positions but no resource ids, clickable bounds, or source lines. A tree gives the agent values it can query, compare, and diff between captures.

### Install the plugin

You need Node.js 20 or newer, `adb` on your `PATH` (or `AUI_ADB` set to its path), a device or emulator with USB debugging enabled, and the target app in the foreground. The `view` and `compose` sources also require a debuggable build (`android:debuggable="true"`); the semantics source works on any app.

From Claude Code, add the marketplace and install the plugin:

```text
/plugin marketplace add Jayvinz/android-ui-inspector
/plugin install android-ui@jayvinz-tools
```

The repository is both the marketplace (`jayvinz-tools`) and its first plugin (`android-ui`); the [plugin reference](https://github.com/Jayvinz/android-ui-inspector/blob/main/docs/plugin.md) lists every component. Claude Code copies the plugin into its cache and installs the Node dependencies from the lockfile, so `dist/` ships prebuilt and there is no compile step. The [Claude Code plugin documentation](https://code.claude.com/docs/en/plugins-reference) covers the install flow on other machines.

The terminal examples in this post use the CLI. The plugin exposes the same capabilities through MCP inside Claude Code; to get the `android-ui` command as well, clone the repository and run `npm install && npm run build && npm link`.

If you would rather not add a marketplace, each release also attaches a self-contained zip of about 6 MB. It includes the built server and its production dependencies, which matters because Claude Code does not install dependencies for a zip loaded in session scope:

```bash
claude --plugin-dir ./android-ui-inspector-1.0.0.zip
```

After either installation, run `/mcp` to confirm the `android-ui` server is loaded and `/help` to see the commands. Restart Claude Code once after installing or updating, because the plugin's gate hook is read at session start.

**Note**: all activation paths first check that the workspace is an Android project (`settings.gradle(.kts)`, `gradlew`, a module applying `com.android.*`, or `AndroidManifest.xml`). In a non-Android repository the plugin only activates when you explicitly ask about a connected device screen or mention Android.

### Point it at a device

Start with the device list and the foreground app. These are the same data the MCP server uses to resolve a target:

```bash
android-ui devices
android-ui state
```

`state` reports the device model and API level, the screen size and density, the foreground package, the Activity, the pid, and the JDWP windows, including dialogs and popups. Every later claim about bounds or clickability is anchored to that target.

If the app is a release build, only the semantics source will work. That is enough for labels and clickable bounds, but the View classes and layout parameters stay unavailable.

### Ask for the screen

In Claude Code you can ask in plain language: "抓取当前页面布局", "summarize the current screen", or "这个按钮为什么是灰的". The `inspect-current-screen` skill maps those requests to `get_state`, `dump_ui`, and the query tools, and it stops at device evidence without opening the repository.

From a terminal, the same path looks like this:

```bash
android-ui dump
android-ui find "登录" --both
android-ui hit 540 2239 --index 0
```

`find` matches text, content descriptions, resource ids, class names, and refs. `hit` returns every node under a coordinate, sorted by visible area, with `--index` to step through overlapping candidates. Search is case-insensitive for `contains`, and `/pattern/flags` is accepted as a regular expression.

Refs such as `v12` or `s43` are valid only for the capture that produced them. The tool re-captures on every command, so a new screen means new refs.

The text output is compact by design:

```text
device 10.0.0.5 (Pixel 7)  android 13 (sdk 33)
screen 1080x2400 @ 440dpi (2.75x) portrait
target com.example.app pid=9597 activity=...MainActivity debuggable
v0 DecorView [0,0][1080,2400] 1080x2400 @(540,1200)
  v1 FrameLayout ...
```

JSON adds `visibleBounds`, `center`, `clickable`, `enabled`, `className`, and the parent path for every node. On a Compose screen `uiKind` is `compose` and refs start with `s`; on a mixed screen both trees appear, and search, hit testing, and taps query both. The [data source guide](https://github.com/Jayvinz/android-ui-inspector/blob/main/docs/data-sources.md) explains which tree wins on each screen type.

*[Figure 2: a `find` result in Claude Code, showing bounds, center, and clickable state]*

**Note**: the human-readable tree is truncated at 2000 nodes by default. `--json` and `--out` write the complete dump; MCP `dump_ui` caps JSON at 800 nodes unless you raise `maxNodes`.

### Trace a control to source

This is the part a coding agent cannot do from a screenshot. The `locate-ui-code` skill and the `locate_code` tool take the anchors from the captured screen (text, content description, resource id, Compose file and line, or View class) and scan the repository for ranked `file:line` candidates:

```text
/android-ui:locate 登录
```

The scan returns string resources, layout definitions, Compose definitions and call sites, ViewBinding usage, and click handlers, each with a score, a reason, and a code snippet. A ranking of 100 marks a `@Composable` definition matched by name or line; 78 marks a layout that defines the resource id; 45 marks a call site. Test sources, `build/`, `.gradle/`, and generated code are excluded by default.

A typical report points at `ProfileScreen.kt:120` for the Composable, `fragment_profile.xml:34` for the layout id, and `ProfileFragment.kt:88` for the click handler. Those are ranked candidates, and opening the files is still required.

The tool is read-only. It ranks files; you or the agent still open them and follow the business chain one to three hops.

### Verify a change

Before and after a UI change, capture the same page twice and compare:

```bash
android-ui dump --json --out .aui/before.json
# rebuild, install, return to the same page and scroll position
android-ui dump --json --out .aui/after.json
android-ui diff .aui/before.json .aui/after.json
android-ui analyze
```

The diff matches nodes by identity (source, resource id, class, text, and path), because refs change between captures. It reports added, removed, and moved or resized nodes, and `--tolerance` (1 px by default) ignores small bound changes. `analyze` runs the rule set: small touch targets, overlapping clickables, clipped nodes, invisible clickables, duplicate ids, deep nesting, and four more.

*[Figure 3: a before/after diff with one added button and one resized row]*

Keep `.aui/` in your `.gitignore`. Dumps contain the device serial, the package name, and the text on screen.

### Connect another MCP client

The plugin wires the server for Claude Code. Every other client starts the same stdio server; only the config shape changes. The CLI writes the right envelope for 20 clients:

```bash
node dist/cli.js mcp --print-config --client codex      # TOML for ~/.codex/config.toml
node dist/cli.js mcp --print-config --client vscode     # servers object for .vscode/mcp.json
node dist/cli.js mcp --print-config --client cursor     # mcpServers object for .cursor/mcp.json
```

Without `--client` you get the `mcpServers` object that Claude Code, Cursor, Cline, Windsurf, Gemini CLI, CodeBuddy, WorkBuddy, and several others read. The snippet goes to stdout and its destination path goes to stderr, so redirecting the output into a config file gives a clean result:

```json
{
  "mcpServers": {
    "android-ui": {
      "command": "node",
      "args": ["/absolute/path/to/android-ui-inspector/dist/mcp.js"]
    }
  }
}
```

`--serial`, `--adb`, and `--studio` carry into the snippet when you need to pin a device or an Android Studio installation. Four clients were exercised end to end on one machine: OpenCode 1.19.5 listed all 14 tools, CodeBuddy Code 2.186.0 and Codex CLI 0.172.0 each called `list_devices` and got a real device back, and WorkBuddy exposed the tools after a one-time GUI approval. The [client matrix](https://github.com/Jayvinz/android-ui-inspector/blob/main/docs/mcp.md#other-clients) records the config file and shape for each one. The remaining clients follow their documented schemas but were not run here.

The four skills travel as well. Their frontmatter uses only `name` and `description`, and their CLI fallback resolves through `AUI_ROOT`, so `node scripts/sync-agent-skills.mjs --dest ../my-app` installs them into `.agents/skills` for Codex CLI, Gemini CLI, Cline, and Goose. Add `--codebuddy` or `--workbuddy` for those clients' directories. Slash commands, the subagent, and the gate hook stay Claude Code specific.

### Where it stops

- `view` and `compose` need a debuggable app; release builds can only use semantics.
- JDWP usually allows one debugger at a time. Attaching may fail while Android Studio is debugging.
- `compose` needs a local Android Studio, Java 17+, API 29+, and 8 to 12 seconds per capture. It leaves a resident transport daemon on the device; `android-ui compose-clean` removes it.
- The semantics tree only sees what the app exposes to accessibility. Text drawn directly to a canvas, a `SurfaceView`, or a `WebView` has no text or children to find.
- `input text` reliably supports ASCII only. Chinese input needs an extra IME such as ADBKeyboard.
- There is no live monitoring. Every command captures a fresh snapshot.
- Interaction tools are available, but the skills are read-only unless you ask for a tap, swipe, or text input.

### What's next

Version 1.0.0 is the first stable release, MIT licensed, and the CLI is usable on its own if you prefer scripts to chat. Install the plugin, put a debug build in the foreground, and ask for the screen. The first useful answer usually arrives within one capture.

The interesting part, at least for me, is how three unrelated Android interfaces end up in one tree that an agent can query. That is [Part 2](https://github.com/Jayvinz/android-ui-inspector/blob/main/blog/2026-11-24-android-ui-inspector-under-the-hood.md).

**Resources**

- [Repository and release notes](https://github.com/Jayvinz/android-ui-inspector)
- [CLI reference](https://github.com/Jayvinz/android-ui-inspector/blob/main/docs/cli.md)
- [MCP tools and limits](https://github.com/Jayvinz/android-ui-inspector/blob/main/docs/mcp.md)
- [Data sources](https://github.com/Jayvinz/android-ui-inspector/blob/main/docs/data-sources.md)
- [Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference)
- [Model Context Protocol](https://modelcontextprotocol.io/)

*The code snippets in this post use the project's MIT license:*

```text
// Copyright (c) Jayvinz. SPDX-License-Identifier: MIT
```
