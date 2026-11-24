# Claude Code plugin

[English](plugin.md) | [简体中文](plugin.zh.md)

The repository is simultaneously a Claude Code marketplace (`jayvinz-tools`) and a plugin (`android-ui`). It bundles the CLI, the MCP server, a UI→code locator script, and a set of skills/commands/agents. The typical task it targets:

> "Locate the **Me** button on the current screen and trace it to its related code logic."

## Names

| Object | Name |
|---|---|
| Product | `Android UI Inspector` |
| GitHub repository | `Jayvinz/android-ui-inspector` |
| Marketplace | `jayvinz-tools` |
| Plugin | `android-ui` |
| npm package name | `android-ui-inspector` (not published to the registry) |
| MCP server | `android-ui` |
| CLI command | `android-ui` |

## Components

| Component | Path | Purpose |
|---|---|---|
| MCP | `.claude-plugin/plugin.json` | Inline `mcpServers`, starts `${CLAUDE_PLUGIN_ROOT}/dist/mcp.js`, providing `dump_ui` / `find_elements` / `locate_code` / `hit_test` / `screenshot` / `open_viewer` / `diff_ui` / `analyze_ui` / `tap` and more |
| Skill | `skills/inspect-current-screen/` | Screen/control observation, direct interaction, layout/accessibility audits, and the explicit browser viewer; no source tracing |
| Skill | `skills/locate-ui-code/` | The full UI element → Compose/XML source → click/state/business-chain workflow and references |
| Skill | `skills/analyze-screen-logic/` | Whole-screen/dialog analysis: implementation, ViewModel/state, data sources, navigation, conditions, and side effects (read-only) |
| Skill | `skills/verify-ui-change/` | Before/after dumps, diff, rule checks, screenshots, and interaction verification |
| Commands | `commands/locate.md`, `screen.md`, `analyze-screen.md`, `view.md`, `verify.md` | `/android-ui:locate`, `:screen`, `:analyze-screen`, `:view`, `:verify` |
| Agent | `agents/ui-code-locator.md` | Read-only UI→code locator subagent for isolating multi-step investigation in a subcontext |
| Hook | `hooks/hooks.json` + `hooks/aui-android-gate.mjs` | `PreToolUse` Android-project gate for `get_state`/`dump_ui`/`find_elements`/`locate_code`/`open_viewer`; restart Claude Code after installing or updating the plugin |
| Script | `scripts/locate-code.mjs` | Dependency-free code anchor scanner (Node built-ins only, no `npm install` needed) |
| Marketplace | `.claude-plugin/marketplace.json` | The `jayvinz-tools` catalog; the repo root is the first plugin |

## Installation

Prerequisites: Node.js ≥ 20, `adb` available; Compose JVMTI additionally needs Android Studio and a debuggable app. Claude Code must be able to call `node` / `npm` from `PATH`.

**Install from the GitHub marketplace** (recommended for other users):

```text
/plugin marketplace add Jayvinz/android-ui-inspector
/plugin install android-ui@jayvinz-tools
```

The repo root is both the marketplace and the first plugin: `.claude-plugin/marketplace.json` has `source: "./"`, the plugin is `android-ui`, the marketplace is `jayvinz-tools`. The package name is `android-ui-inspector`, but it is not published to the npm registry: install the plugin, or `npm link` from a clone. Either way the CLI command is `android-ui`.

On a GitHub install, Claude Code copies the plugin into its cache and installs Node dependencies from `package.json` + `package-lock.json` (no lifecycle scripts, 60s timeout). That is why `dist/` must be committed and `node_modules/` must not.

**Local development/debugging**:

```bash
npm install
npm run build
```

```text
/plugin marketplace add E:/repo/android-ui-inspector
/plugin install android-ui@jayvinz-tools
```

(Replace `E:/repo/android-ui-inspector` with your actual path.)

A marketplace added from a **local path** loads plugins in place and does not install dependencies for you, so run `npm install && npm run build` first.

Or load for the current session only:

```bash
claude --plugin-dir E:/repo/android-ui-inspector
```

After installation `/mcp` should show the `android-ui` server and `/help` should list `/android-ui:locate`, `:screen`, `:analyze-screen`, `:view`, `:verify`.

## Typical workflow

For "locate the Me button on the current screen and trace it to its related code logic":

1. `get_state` confirms the foreground package, Activity, screen, and pid;
2. `dump_ui(source="auto", format="tree")` yields `uiKind` and the nodes;
3. On Compose screens add `dump_ui(source="compose")` to get Composable `file:line`;
4. `find_elements` / `hit_test` lock onto the target; record text/id/bounds/clickable;
5. `locate_code` (or the locate script directly) returns string, layout, Compose, ViewBinding, and click-handler candidates;
6. Open the candidate files to verify, follow 1–3 hops of business logic, and report with `file:line`.

Natural-language requests about the current screen or a visible control ("抓取当前页面布局", "看下这个按钮", "有没有重叠") route through the `inspect-current-screen` skill instead: `get_state` → `dump_ui(format="tree")` → `find_elements` / `hit_test`, optionally `analyze_ui` and `screenshot`. That path stops after device evidence and never calls `locate_code`; only source questions continue into the workflow above.

Whole-screen/dialog requests ("分析当前界面的代码和业务逻辑", "分析这个弹窗的数据从哪来") route through `analyze-screen-logic`: capture (`get_state` + `dump_ui(auto, tree)`) → classify page/dialog/bottom sheet and list sections (dump a separate window when needed) → resolve the Activity/Fragment/Composable/route/dialog class → map sections to `file:line` → follow ViewModel/state → Repository/API/cache for 1–3 hops, marking each hop confirmed or inferred. It is read-only and does not edit code.

Explicit visual requests ("打开可视化看看", "在浏览器里打开当前页面", "open the UI viewer") use `/android-ui:view` or the `open_viewer` tool: one capture, one self-contained `.aui/viewer.html`, then the default browser. No dump/find/analyze/screenshot/verify path launches a browser.

**Android project gate.** Every activation path first checks that the working directory (or the named repo root) is an Android project: `settings.gradle(.kts)`, `gradlew(.bat)`, a module `build.gradle(.kts)` applying `com.android.*`, or `AndroidManifest.xml`. In a non-Android repository the plugin activates only when the user explicitly asks to inspect the device screen/page or explicitly mentions Android. A connected device does not make the repository Android. A `PreToolUse` hook enforces the gate for `get_state`/`dump_ui`/`find_elements`/`locate_code`/`open_viewer`; restart Claude Code after install/update.

Or call the commands directly:

```text
/android-ui:locate Me
/android-ui:screen
/android-ui:analyze-screen
/android-ui:view
/android-ui:verify
```

## Locate script

```bash
node scripts/locate-code.mjs --root . \
  --text "Me" \
  --desc "打开个人中心" \
  --id "profile_tab" \
  --compose-name "ProfileTab" \
  --compose-file "ProfileScreen.kt" \
  --compose-line 120 \
  --class "ProfileEntryView" \
  --json
```

- `anchors`: `string` resources hit by text, normalized ids, Compose definitions;
- `candidates`: score-ranked `file:line` entries whose `kind` includes `compose-definition`, `layout-id`, `layout-include-chain`, `binding-usage`, `string-usage-compose`, `click-handler`, and more;
- `build/`, `.gradle/`, `generated/`, `node_modules/`, and test code are excluded by default; adjust with `--exclude` / `--include-tests`;
- `--compose-file` + `--compose-line` resolve to the enclosing `@Composable` definition and list call sites; if the reported line is actually a call site, confirm the definition by name instead of trusting the line number alone.

The script only ranks candidates — always open the files to confirm. It never modifies the repository.

## Agent

`ui-code-locator` is a read-only subagent suited to "capture screen → find node → scan candidates → read code" multi-step work, so the main session only receives the conclusion. By default it performs no edits, builds, installs, or taps.

## Environment variables

The plugin manifest's `mcpServers` injects no environment variables; the MCP process inherits the user's shell environment. To pin serial/adb/Studio parameters, prefer environment variables or start a separate server via a project-level `.mcp.json`. The full variable table lives in [cli.md](cli.md#environment-variables).

## Read-only and permissions

- Skills/agent are read-only by default; `tap`/`swipe`/`input_text` are explicit interaction tools triggered by user requests.
- The locate/verify workflows write `.aui/before.json`, `.aui/after.json`, `.aui/*.png` inside the repository; add `.aui/` to `.gitignore` (this repo already does).
- Do not commit dumps: they may contain device serials, foreground package names, and screen text.

## Adding a second plugin later

This project is the first plugin of the marketplace, with `source` pointing at the repo root. To add another plugin later:

```text
android-ui-inspector/
├── .claude-plugin/
│   ├── marketplace.json       # jayvinz-tools catalog
│   └── plugin.json            # first plugin android-ui
├── plugins/
│   └── another-plugin/
│       └── .claude-plugin/plugin.json
```

Append to the `plugins` array in `.claude-plugin/marketplace.json`:

```json
{
  "name": "another-plugin",
  "source": "./plugins/another-plugin",
  "description": "..."
}
```

The entry `name` must match `name` in `plugins/another-plugin/.claude-plugin/plugin.json`. Then run:

```bash
claude plugin validate --strict .
```

## Release and validation

- The marketplace and plugin live in the same GitHub repository; after pushing, users can install with `/plugin marketplace add <owner>/<repo>` — no review required.
- The repository is conventionally `Jayvinz/android-ui-inspector`; if the GitHub owner/repo differs, update `marketplace.json`'s `owner.url`, `plugin.json`'s `homepage`/`repository`, and the install commands in the READMEs together.
- Run `claude plugin validate --strict .` before a release; the CI workflow `.github/workflows/validate.yml` runs typecheck, tests, build, verifies `dist/` matches the source, and finishes with the same validation.
- To go further into the official Anthropic directory: submit a Plugin bundle at `claude.ai/directory/manage` — it requires a paid claude.ai plan, a GitHub repository, automated validation and security scanning, and new listings pass human review; `claude-plugins-official` itself accepts no public submissions.

## Versioning

`package.json` is the only source of truth for the version. Claude Code needs a literal `version` in `.claude-plugin/plugin.json`, so `scripts/sync-version.mjs` keeps them equal:

```bash
npm version patch    # updates package.json / package-lock; the lifecycle script writes plugin.json and git-adds it
npm version minor
npm version major
```

Without `npm version`, sync manually:

```bash
node scripts/sync-version.mjs
```

CI runs this check:

```bash
node scripts/sync-version.mjs --check
```

A mismatch fails CI directly — there is no need to edit two files by hand.
