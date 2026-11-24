# Publishing notes

Internal notes for the two Medium drafts. Not part of the articles.

## Post 1: "Inspect a Live Android Screen from Your Coding Agent"

- Subtitle: Part 1 of two: connect a client, read the screen, trace a control to source.
- Tags: Android, AI Coding Agents, MCP, Developer Tools, Mobile Development.
- Figures to capture (replace the italic placeholders):
  1. `.aui/viewer.html` open in a browser, with the node tree and screenshot overlay visible.
  2. A Claude Code session showing a `find_elements` result with bounds, center, and clickable state.
  3. A `diff_ui` run with one added button and one resized row.
- Canonical URL: the GitHub blob URL of this file once committed.

## Post 2: "How Android Layout MCP Reads a Screen: JDWP, UIAutomator, and JVMTI"

- Subtitle: Part 2 of two.
- Tags: Android, Reverse Engineering, Debugging, Jetpack Compose, Developer Tools.
- Figures:
  1. Architecture diagram: view / semantics / compose sources into one `UiNode` tree.
  2. Sequence diagram: handshake, `VULW`, `VURT`, `dumpv2` reply.
  3. Device staging diagram: Studio artifacts, daemon, `code_cache`, gRPC.
- Canonical URL: the GitHub blob URL of this file once committed.

## Facts used (checked against the repository at v0.1.0)

- 14 MCP tools, 18 CLI subcommands, 10 analysis rules, 104 tests.
- 20 MCP client configs via `--client` across seven shapes; four clients verified locally (OpenCode, CodeBuddy Code, Codex CLI, WorkBuddy).
- Four tests in `test/cross-agent-compat.test.ts` derive expectations from `MCP_CLIENT_IDS`; details in `docs/cross-agent.md`.
- Compose inspector default 1.8.3, API 29+, 8 to 12 seconds per capture.
- Text output truncated at 2000 nodes; MCP JSON default 800, max 5000.
- Viewer budget 8 MB, minimum 200 nodes.
- Locator scores: 100 compose definition, 90 compose location, 80 strong id usage, 78 layout id, 45 call site.
- Release bundle: about 6 MB, includes production `node_modules` and `package-lock.json`.

## Before publishing

- Replace every `*[Figure N: ...]*` line with the real image and caption.
- Confirm the release zip filename in Post 1 matches the current release.
- Add the canonical link after the files are pushed.
- Re-run the de-AI read on any paragraph added during editing.
