# Publishing notes

Internal notes for the two Medium drafts. Not part of the articles.

## Post 1: "Give Your Coding Agent a Live View of the Android Screen"

- Genre: hands-on tutorial. Subtitle: Part 1 of two: capture, locate, and trace.
- Tags: Android, AI Coding Agents, MCP, Developer Tools, Mobile Development.
- Figures (all eight are rendered and committed under `blog/images/`):
  1. `p1-fig0-pipeline.png` — the five stages: connect, state, capture, locate, trace; first three touch the device, last two touch the repo, all read-only.
  2. `p1-fig1-dump.png` — a real `android-layout dump` on a DroidReel build: device header, `primary source: semantics`, and the tree ending at `s43 TextView "开拍"` under `s42 {click}`.
  3. `settle-probe.png` — the `--settle` frame counter: bars decaying to zero, a budget line, and the three outcomes written both ways (`stable: yes | no | unknown`, JSON `true | false | null`).
  4. `p1-fig2b-compact.png` — `--format compact` before and after: 20 nodes to 9, dropped wrappers greyed out, `stats` printed below.
  5. `p1-fig2-heldout.png` — the annotated screen: dashed boxes on the two unlabelled cards (`s37`, `s38`), a red box on the `开拍` tab (`s42`), and `find` / `analyze` output beside it.
  6. `p1-fig2-find.png` — `find "Re-run checks"` and `hit 289 1019` on the XML fixture, showing the six stacked nodes smallest-first.
  7. `p1-fig4-locate-ladder.png` — the `locate_code` score ladder: 100 / 90 / 80 / 78 grouped as strong evidence, 48 / 45 as weaker, with a real run printed below.
  8. `p1-fig3-session.png` — a real Claude Code transcript: `dump_ui`, `find_elements`, `locate_code` (`ChatScreen.kt:233`), then `Read` at that offset.
- Canonical URL: the GitHub blob URL of this file once committed.
- Length check: about 1,730 words of prose, 11 code blocks, and 8 figures, which sits inside the tutorial range.

## Post 2: "Four Android APIs, One Screen Tree: how a capture works"

- Genre: concept explainer. Subtitle: Part 2 of two: JDWP, UIAutomator, dumpsys, and the Compose inspector.
- Tags: Android, Reverse Engineering, Debugging, Jetpack Compose, Developer Tools.
- Figures (all seven are rendered and committed under `blog/images/`):
  1. `p2-fig1-four-sources.png` — the four source cards feeding one normalized `UiNode`, plus measured node counts on one Compose screen.
  2. `p2-fig5-coords-clip.png` — three nested containers and three nodes: `null`, cropped, and fully visible, with the walk formula.
  3. `p2-fig2-jdwp-sequence.png` — the four-step JDWP sequence across client, app process, and `android.view.ViewDebug`.
  4. `p2-fig3-device-staging.png` — host-side Studio / Maven / javac caching against the five artifacts staged on the device.
  5. `p2-fig4-dumpsys-merge.png` — dumpsys geometry joined with semantics text, before and after, plus the three join rules.
  6. `p2-fig6-source-choice.png` — the `--source auto` decision tree and the result / primary / fallback table.
  7. `p2-fig7-rules.png` — the twelve analysis rules in four columns by the evidence each reads, with severity per rule.
- Canonical URL: the GitHub blob URL of this file once committed.
- Length check: about 1,800 words of prose, 7 code blocks, and 7 figures, at the upper end of the concept range.

## Facts used (checked against the repository at v0.10.0)

- 9 MCP tools, 13 CLI subcommands, 12 analysis rules, 5 skills, 5 commands. (Do not quote a test count: the suite grows with every change.)
- 20 MCP client configs via `--client` across seven shapes; four clients verified locally (OpenCode, CodeBuddy Code, Codex CLI, WorkBuddy).
- `test/cross-agent-compat.test.ts` derives its expectations from `MCP_CLIENT_IDS`; details in `docs/cross-agent.md`.
- Compose inspector default 1.8.3, API 29+, Java 17+, 8 to 12 seconds per capture; the View inspector runs with screenshots disabled to avoid a 78 MB SKP peak on a 256 MB heap.
- Caps: CLI text 2000 nodes; MCP JSON 800 by default and 5000 at most; MCP tree 1500.
- Locator scores: 100 compose definition, 90 compose location, 80 strong id usage, 78 layout id, 48 literal text, 45 call site.
- Measured fixture sizes: XML app 20 view nodes vs 18 semantics nodes; Compose app 10 view vs 49 semantics vs 489 Compose nodes.
- `compact` on the XML fixture: 20 nodes in, 9 kept, 11 dropped, `truncated: false`.
- Real DroidReel capture used for the annotated figure: 57 nodes at density 2.75, `analyze` reports exactly 2 `unlabeled_clickable` issues (`s37`, `s38`); `find "开拍"` returns `s43` at centre (570,2260), whose parent `s42` is the 261x74 clickable `View`.
- `settle` samples `dumpsys gfxinfo` every 250 ms, budgets three seconds, and reports three outcomes: the header says `stable: yes | no | unknown`, the JSON field says `true | false | null`.
- Multi-window: `window=all`, primary is the focused window, cap of 8 windows, one shared `maxNodes` budget.
- Capture retry: once after 300 ms; JDWP attach failures are not retried (about 10 seconds per attempt).
- Release bundle: about 6.4 MB including production `node_modules` and `package-lock.json`.

## Before publishing

- Figures are done: 8 in Post 1 and 7 in Post 2, all PNGs in `blog/images/` with re-renderable sources in `blog/images/src/`. No `*[Figure N: ...]*` placeholders remain in either draft.
- Confirm the release zip filename in Post 1 matches the current release (`android-layout-mcp-0.10.0.zip`).
- Add the canonical link after the files are pushed.
- Re-run the de-AI read on any paragraph added during editing.