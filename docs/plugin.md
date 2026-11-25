# Claude Code plugin

[English](plugin.md) | [简体中文](plugin.zh.md)

The repository is simultaneously a Claude Code marketplace (`jayvinz-tools`) and a plugin (`android-layout`). It bundles the CLI, the MCP server, a UI→code locator script, and a set of skills/commands/agents. This page covers the Claude Code packaging; the MCP server and skills also work in other agents, described in the [cross-agent guide](cross-agent.md). The typical task it targets:

> "Locate the **Me** button on the current screen and trace it to its related code logic."

## Names

| Object | Name |
|---|---|
| Product | `Android Layout MCP` |
| GitHub repository | `Jayvinz/android-layout-mcp` |
| Marketplace | `jayvinz-tools` |
| Plugin | `android-layout` |
| npm package name | `android-layout-mcp` (not published to the registry) |
| MCP server | `android-layout` |
| CLI command | `android-layout` |

The repository and npm package keep the `-mcp` suffix (`android-layout-mcp`); the plugin slug, MCP
server key, and CLI command are the shorter `android-layout`.

## Components

| Component | Path | Purpose |
|---|---|---|
| MCP | `.claude-plugin/plugin.json` | Inline `mcpServers`, starts `${CLAUDE_PLUGIN_ROOT}/dist/mcp.js`, providing `dump_ui` / `find_elements` / `locate_code` / `hit_test` / `list_fragments` / `screenshot` / `analyze_ui` and more |
| Skill | `skills/capture-ui/` | Screen facts — structure, Activity, `uiKind`, entry points, coordinates — plus the saved json/png/xml artifacts |
| Skill | `skills/inspect-view-attribute/` | One control's raw layout and style values: margins, padding, measured size, text metrics, background, RTL |
| Skill | `skills/trace-view-wiring/` | One control → implementation, click handler, visibility control, and text/image/background injection |
| Skill | `skills/trace-ui-to-logic/` | One section's UI → state holder → data source chain (read-only) |
| Skill | `skills/audit-ui/` | Defect judgments from 12 layout and accessibility rules |
| Commands | `commands/capture.md`, `inspect.md`, `locate.md`, `analyze.md`, `audit.md` | `/android-layout:capture`, `:inspect`, `:locate`, `:analyze`, `:audit` |
| Hook | `hooks/hooks.json` + `hooks/aui-android-gate.mjs` | `PreToolUse` Android-project gate for `get_state`/`dump_ui`/`find_elements`/`locate_code`; restart Claude Code after installing or updating the plugin |
| Script | `scripts/locate-code.mjs` | Dependency-free code anchor scanner (Node built-ins only, no `npm install` needed) |
| Script | `scripts/sync-agent-skills.mjs` | Copies `skills/` into `.agents/skills/` (Codex CLI, Gemini CLI, Cline, Goose), `.codebuddy/skills/` (CodeBuddy, `--codebuddy`), or `.workbuddy/skills/` (WorkBuddy, `--workbuddy`) |
| Marketplace | `.claude-plugin/marketplace.json` | The `jayvinz-tools` catalog; the repo root is the first plugin |

Only the skills and the MCP server travel to other agents; the commands and the hook are Claude Code specific. See [mcp.md](mcp.md#other-clients) for the per-client configs and the skills install flow.

## Installation

Prerequisites: Node.js ≥ 20, `adb` available; Compose JVMTI additionally needs Android Studio and a debuggable app. Claude Code must be able to call `node` / `npm` from `PATH`.

**Install from the GitHub marketplace** (recommended for other users):

```text
/plugin marketplace add Jayvinz/android-layout-mcp
/plugin install android-layout@jayvinz-tools
```

The repo root is both the marketplace and the first plugin: `.claude-plugin/marketplace.json` has `source: "./"`, the plugin is `android-layout`, the marketplace is `jayvinz-tools`. The package name is `android-layout-mcp`, but it is not published to the npm registry: install the plugin, or `npm link` from a clone. Either way the CLI command is `android-layout`.

On a GitHub install, Claude Code copies the plugin into its cache and installs Node dependencies from `package.json` + `package-lock.json` (no lifecycle scripts, 60s timeout). That is why `dist/` must be committed and `node_modules/` must not be committed to the repository — the release bundle ships its own production copy instead (see [Plugin bundle](#plugin-bundle)).

**Install a release bundle** (no clone, no marketplace). Every GitHub Release attaches a self-contained plugin zip built from the tagged commit; download `android-layout-mcp-<version>.zip` from the release page and load it:

```bash
claude --plugin-dir ./android-layout-mcp-<version>.zip
# or point at the release asset URL directly
claude --plugin-url <release-asset-url>
```

The bundle ships the built `dist/`, the committed helper jar, and production `node_modules/`, so there is no compile or install step: it works offline and from a session-scoped `--plugin-dir`/`--plugin-url` load, where Claude Code does not install dependencies. Loading a `.zip` needs a Claude Code build that supports zip plugins; on an older build, use the marketplace install instead. See [Plugin bundle](#plugin-bundle) for the exact contents.

**Local development/debugging**:

```bash
npm install
npm run build
```

```text
/plugin marketplace add E:/repo/android-layout-mcp
/plugin install android-layout@jayvinz-tools
```

(Replace `E:/repo/android-layout-mcp` with your actual path.)

A marketplace added from a **local path** loads plugins in place and does not install dependencies for you, so run `npm install && npm run build` first.

Or load for the current session only:

```bash
claude --plugin-dir E:/repo/android-layout-mcp
```

After installation `/mcp` should show the `android-layout` server and `/help` should list `/android-layout:capture`, `:inspect`, `:locate`, `:analyze`, `:audit`.

## Typical workflow

For "locate the Me button on the current screen and trace it to its related code logic":

1. `get_state` confirms the foreground package, Activity, screen, and pid;
2. `dump_ui(source="auto", format="tree")` yields `uiKind` and the nodes;
3. On Compose screens add `dump_ui(source="compose")` to get Composable `file:line`;
4. `find_elements` / `hit_test` lock onto the target; record text/id/bounds/clickable;
5. `locate_code` (or the locate script directly) returns string, layout, Compose, ViewBinding, and click-handler candidates;
6. Open the candidate files to verify, follow 1–3 hops of business logic, and report with `file:line`.

Natural-language requests about the current screen or a visible control ("抓取当前页面布局", "看下这个按钮", "有没有重叠") route through the `capture-ui` skill instead: `get_state` → `dump_ui(format="tree")` → `find_elements` / `hit_test`, optionally `analyze_ui` and `screenshot`. That path stops after device evidence and never calls `locate_code`; only source questions continue into the workflow above.

Whole-screen/dialog requests ("分析当前界面的代码和业务逻辑", "分析这个弹窗的数据从哪来") route through `trace-ui-to-logic`: capture (`get_state` + `dump_ui(auto, tree)`) → classify page/dialog/bottom sheet and list sections (dump a separate window when needed) → resolve the Activity/Fragment/Composable/route/dialog class → map sections to `file:line` → follow ViewModel/state → Repository/API/cache for 1–3 hops, marking each hop confirmed or inferred. It is read-only and does not edit code.

**Android project gate.** Every activation path first checks that the working directory (or the named repo root) is an Android project: `settings.gradle(.kts)`, `gradlew(.bat)`, a module `build.gradle(.kts)` applying `com.android.*`, or `AndroidManifest.xml`. In a non-Android repository the plugin activates only when the user explicitly asks to inspect the device screen/page or explicitly mentions Android. A connected device does not make the repository Android. A `PreToolUse` hook enforces the gate for `get_state`/`dump_ui`/`find_elements`/`locate_code`; restart Claude Code after install/update.

Or call the commands directly:

```text
/android-layout:capture
/android-layout:inspect-view Me
/android-layout:trace-view Me
/android-layout:trace-logic "the feed list"
/android-layout:audit
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

`capture-ui` is a read-only subagent suited to "capture screen → find node → scan candidates → read code" multi-step work, so the main session only receives the conclusion. It performs no edits, builds, installs, or device input.

## Environment variables

The plugin manifest's `mcpServers` injects no environment variables; the MCP process inherits the user's shell environment. To pin serial/adb/Studio parameters, prefer environment variables or start a separate server via a project-level `.mcp.json`. The full variable table lives in [cli.md](cli.md#environment-variables).

## Read-only and permissions

- Every skill and the agent are read-only: the plugin observes and analyzes a device but never taps, swipes, types, or sends key events.
- The capture workflow writes `.aui/capture.json`, `.aui/capture.png`, and `.aui/capture.xml` inside the repository; add `.aui/` to `.gitignore` (this repo already does).
- Do not commit dumps: they may contain device serials, foreground package names, and screen text.

## Adding a second plugin later

This project is the first plugin of the marketplace, with `source` pointing at the repo root. To add another plugin later:

```text
android-layout/
├── .claude-plugin/
│   ├── marketplace.json       # jayvinz-tools catalog
│   └── plugin.json            # first plugin android-layout
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
- The repository is conventionally `Jayvinz/android-layout-mcp`; if the GitHub owner/repo differs, update `marketplace.json`'s `owner.url`, `plugin.json`'s `homepage`/`repository`, and the install commands in the READMEs together.
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

### Releasing

Pushing a `v*` tag triggers `.github/workflows/release.yml`: it verifies the tag matches the `package.json` version, reruns the validate checks (version sync, typecheck, tests, build, `dist/` diff), and then publishes the GitHub Release with generated notes.

```bash
npm version 1.0.0 --no-git-tag-version   # updates package.json, package-lock.json, and plugin.json
npm run typecheck && npm test && npm run build
git commit -am "chore: release v1.0.0"
git tag -a v1.0.0 -m "v1.0.0"
git push origin main v1.0.0
```

Publishing to npm stays a separate manual step: `npm publish` (`prepublishOnly` runs the version check, typecheck, tests, and build first).

### Plugin bundle

The release workflow also builds `dist-plugin/android-layout-mcp-<version>.zip` and attaches it to the GitHub Release. The archive root is the plugin folder (`.claude-plugin/plugin.json`, `dist/`, `helper/`, `hooks/`, `skills/`, `commands/`, `agents/`, `scripts/locate-code.mjs`, `package.json`, `package-lock.json`, production `node_modules/`, `README.md`, `README.zh.md`, `LICENSE`, `NOTICE`), so it loads as a plugin without unzipping. Development-only files (`src/`, `docs/`, `test/`, `evals/`, CI config, dev dependencies) are not bundled:

```bash
claude --plugin-dir ./android-layout-mcp-<version>.zip
claude --plugin-url <release-asset-url>
```

Dependencies are bundled on purpose. Claude Code installs a plugin's npm packages only when it copies the plugin into its cache, and only when the plugin root has `package.json` plus a supported lockfile; a `.zip` loaded through `--plugin-dir`/`--plugin-url` is unpacked into a session temp folder and never gets that install. Shipping production `node_modules/` (about 6 MB in the archive, pure JavaScript, no native modules) keeps every load path working, and the lockfile lets a later cache install reproduce the same set.

Build it locally with `npm run build:plugin-zip`, which runs `npm ci --omit=dev` in a temp stage (needs registry access; ~10s). `--no-deps` skips that for an offline build: the resulting zip is ~190 KB but needs `npm ci --omit=dev` after unzipping. The archive is reproducible: entry timestamps are fixed (1980-01-01) and `SOURCE_DATE_EPOCH` overrides them, so the same commit always yields the same file. `--root <dir>` bundles another tree, which is how a release asset is rebuilt from exactly the tagged commit.
