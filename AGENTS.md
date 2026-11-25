# AGENTS.md

This file provides guidance to Claude Code and other coding agents when working with code in this repository.

## Commands

```bash
npm install
npm run build          # tsc -> dist/ (committed; see below)
npm run typecheck      # tsc --noEmit (there is no separate linter)
npm test               # node:test via tsx, offline fixture tests
npx tsx --test test/query.test.ts   # run a single test file
npm run dev -- dump    # run the CLI from source (tsx src/cli.ts)
npx tsx src/cli.ts find "开拍" --json
node dist/mcp.js       # start the built MCP server over stdio
node dist/cli.js mcp --print-config

npm run build:helper   # rebuild helper/aui-compose-helper.jar against the local Android Studio
npm run build:plugin-zip   # build dist-plugin/android-layout-mcp-<version>.zip (gitignored; stages npm ci --omit=dev, --no-deps to skip)
node scripts/sync-agent-skills.mjs --dest <project>   # copy skills/ into <project>/.agents/skills (--codebuddy, --workbuddy, --both, --global, --check, --dry-run)
node scripts/sync-version.mjs          # sync package.json version -> .claude-plugin/plugin.json
node scripts/sync-version.mjs --check  # CI/release check
npm version patch      # bumps package.json and syncs plugin.json via the "version" lifecycle script
claude plugin validate --strict .      # validate plugin + marketplace manifests
claude plugin eval . --case 'trigger-*' --runs 1 --ablation none --trust-plugin --no-publish --max-cost-usd 4  # mocked activation regression, no device
```

Tests are fixture-based (`test/fixtures/`) and need no device. The fixtures are real API 33 captures: a Compose app's `ViewDebug.dumpv2` binary, an XML app's binary, uiautomator XML, a screenshot, and Compose helper JSON.

`evals/` holds mocked activation regression cases (`prompt.md` + `graders/*.md`). They assert skill/tool selection, not code output; `evals/mocks/` replaces the MCP server, so no device is needed. `evals/mocks/android-layout/_tools.json` is a saved `tools/list` snapshot; regenerate it after changing tool descriptions in `src/mcp.ts` and rebuilding `dist/`. They are not part of CI because they run real Claude Code sessions and cost tokens.

## Language conventions

- Write code comments, documentation prose, and commit messages in English by default.
- When adding or updating user-facing documentation, also provide an English section (or a linked English version) alongside any Chinese content. Do not create new Chinese-only docs.
- Skill bodies are English. Skill `description` frontmatter is the exception: keep the English trigger description and append the Chinese trigger phrases users actually type, so Chinese requests still activate the skill.
- Keep CLI flags, command examples, identifiers, and file paths identical across languages; translate only the surrounding prose.

User-facing docs come in parallel language versions that link to each other: `README.md` (English) and `README.zh.md` (Chinese), plus `docs/*.md` (English) with `docs/*.zh.md` (Chinese counterparts). Keep both sides in sync when content changes.

## Critical build/packaging constraints

- **`dist/` is intentionally committed.** GitHub marketplace installs copy the repo and start the MCP server from `dist/mcp.js`; `node_modules/` is not committed. CI runs `git diff --exit-code -- dist`, so after changing anything in `src/`, run `npm run build` and commit the regenerated `dist/` (and `dist/*.d.ts`) in the same change. Never hand-edit `dist/`.
- **`package.json` is the only version source.** `.claude-plugin/plugin.json` needs a literal version; `scripts/sync-version.mjs` keeps them equal. `prepublishOnly` and CI fail on mismatch.
- The repository is simultaneously an npm package (`android-layout-mcp`, binary `android-layout`) and a Claude Code plugin + marketplace:
  - `.claude-plugin/plugin.json` — plugin `android-layout`; inline `mcpServers` launches `${CLAUDE_PLUGIN_ROOT}/dist/mcp.js`.
  - `.claude-plugin/marketplace.json` — marketplace `jayvinz-tools`, with `source: "./"` (repo root is the first plugin).
  - `skills/`, `commands/`, `agents/` are shipped plugin components. `scripts/locate-code.mjs` and `scripts/sync-agent-skills.mjs` are dependency-free so they work before `npm install`.
  - Beyond Claude Code, the plugin reaches other agents in two layers: `mcp --print-config --client <id>` shapes the MCP config for 20 clients (`src/core/mcp-config.ts`), and the five skills stay portable — only `name` + `description` frontmatter, no `${CLAUDE_PLUGIN_ROOT}` in executable paths (they use `AUI_ROOT`), so `scripts/sync-agent-skills.mjs` can copy them to `.agents/skills/` (Codex CLI, Gemini CLI, Cline, Goose), `.codebuddy/skills/` (CodeBuddy, via `--codebuddy`), or `.workbuddy/skills/` (WorkBuddy, via `--workbuddy`). `--both` writes the first two. Cursor and VS Code read `.claude/skills/` directly. Commands and the `PreToolUse` hook stay Claude Code specific; do not add agent-specific fields to skill frontmatter. `test/agent-portability.test.ts` guards these rules. Verified locally with OpenCode 1.19.5, CodeBuddy Code 2.186.0, Codex CLI 0.172.0, and WorkBuddy (its custom MCP needs one-time GUI approval); see `docs/mcp.md#verified-locally`. The full engineering record, including per-client gotchas and the "add a client" checklist, is `docs/cross-agent.md` (zh: `docs/cross-agent.zh.md`). `test/cross-agent-compat.test.ts` derives its expectations from `MCP_CLIENT_IDS`, so a client id added in code without updating the client tables in README (both languages), `docs/mcp.*`, and `docs/cross-agent.*` fails CI.
- The module system is ESM (`"type": "module"`, TypeScript `NodeNext`): relative imports in `src/` must use the `.js` extension, even when importing a `.ts` file.
- CI (`.github/workflows/validate.yml`) runs, in order: `sync-version --check`, typecheck, tests, build, `git diff --exit-code -- dist`, then `claude plugin validate --strict .`.
- Pushing a `v*` tag runs `.github/workflows/release.yml`: it checks the tag against `package.json`, reruns the validate steps, builds and re-validates the Claude Code plugin bundle (`npm run build:plugin-zip` → `dist-plugin/android-layout-mcp-<version>.zip`, archive root = plugin folder), then creates the GitHub Release and attaches that bundle. `dist-plugin/` is a build output and is gitignored.
- The bundle must stay self-contained: it ships production `node_modules/` plus `package-lock.json` because Claude Code installs plugin dependencies only when copying into its cache (and only with a lockfile), while `--plugin-dir`/`--plugin-url` archives are unpacked to a session temp folder with no install. Keep `helper/` and `scripts/locate-code.mjs` beside `dist/` for the same reason.
- Do not commit dumps or screenshots: they contain device serials, package names, and screen text. `.aui/`, `aui-fallback-*.png`, and `*.annotated.svg` are gitignored.

## Architecture

Two front ends, one core:

```
src/cli.ts (commander) ─┐
                        ├── src/core/* ─── adb / device
src/mcp.ts (MCP stdio) ─┘        ├── view  : JDWP + DDMS ViewDebug v2 (View properties)
                                 ├── semantics : adb uiautomator XML (Compose text/controls)
                                 ├── dumpsys : dumpsys activity (View classes/ids on any app + Fragments)
                                 └── compose : Android Studio transport + JVMTI + helper JAR
```

- `src/cli.ts` and `src/mcp.ts` are thin wrappers. Keep them in parity: a new inspection capability normally means a core function, a CLI subcommand, and an MCP tool. Both call the same `capture()` and `treesFor()` so behavior does not diverge.
- **The five skills split on two axes: granularity (control / section / screen) and intent (facts / properties / source / defects).** Each cell has exactly one owner:

|  | Facts | Property values | Source code | Defects |
|---|---|---|---|---|
| **One control** | `capture-ui` (locate part) | `inspect-view-attribute` | `trace-view-wiring` | — |
| **One section** | — | — | `trace-ui-to-logic` | — |
| **Whole screen** | `capture-ui` | — | — | `audit-ui` |

  `capture-ui` owns screen facts (structure, entry points, coordinates) plus the capture artifacts; `inspect-view-attribute` owns one control's raw layout and style values; `trace-view-wiring` owns one control's implementation, click handler, visibility rule, and content injection; `trace-ui-to-logic` owns one section's UI→state→data chain; `audit-ui` owns defect judgments from the 12 rules. Every description states its `Owns:` and `Not:` clause, and no trigger phrase may be quoted by two skills — `test/skills.test.ts` enforces both.
- Commands are thin entry points: each binds `$ARGUMENTS`, names its skill, and carries at most one gate pointer line. The gate body lives in the skills only, so a command never restates a rule. `test/skills.test.ts` enforces the size and the pointer shape.
- All five skills, the five commands, and the `get_state`/`dump_ui`/`find_elements`/`locate_code` MCP descriptions carry the Android-project gate: activation targets Android projects (`settings.gradle(.kts)`, `gradlew`, a module applying `com.android.*`, or `AndroidManifest.xml`). In a non-Android repository, activate only on an explicit device/screen request or an explicit Android mention; a connected device does not make the repository Android.
- The gate is enforced twice: hard-stop prose in every skill/command body and a `PreToolUse` hook (`hooks/hooks.json` + `hooks/aui-android-gate.mjs`) that denies `get_state`/`dump_ui`/`find_elements`/`locate_code` in a non-Android workspace unless the latest user prompt explicitly asks about a device screen/page or Android; `locate_code` additionally requires an Android project or an explicit Android mention. `claude plugin eval` does not load plugin hooks, so the hook is unit-tested in `test/android-gate.test.ts` and the non-Android refusal prompts live under `evals/manual-gate-*` (outside the `trigger-*` glob). Hooks load at session start; restart after install/update.
- `src/core/capture.ts` orchestrates everything: resolves device/foreground app/pid, captures the requested trees, classifies the screen (`classifyUi`: `xml` / `compose` / `mixed` / `unknown`), picks the primary source for `auto`, and returns one `CaptureResult`. `treesFor(result, source, both)` is the single source-to-trees policy shared by CLI and MCP.
  - `auto` captures view + semantics, then chooses view for XML, semantics for Compose (ViewDebug stops at `AndroidComposeView`), and renders/searches both for mixed screens.
  - `compose` is opt-in (`--source compose`) because it requires a debuggable app, Android Studio, Java, and takes ~8–12s.
- `src/core/model.ts` defines the normalized tree. Every source produces the same `UiNode` shape, with `source`, `ref` (`v*` view, `s*` semantics, `c*` compose), raw `bounds`, clipped `visibleBounds`, `center`, and source-specific extras (`view` or `compose`). `ref`/`id` are valid only for one capture.
- Source implementations:
  - `adb.ts` — ADB wrapper (device list, screen info, foreground app, pid lookup, input, screenshot, port forwards). Respects `AUI_ADB`/`ADB_PATH`, `ANDROID_SERIAL`, `AUI_JAVA`, `AUI_ANDROID_STUDIO`, `AUI_COMPOSE_VERSION`, `AUI_COMPOSE_INSPECTOR_JAR`, `AUI_NO_FALLBACK_SCREENSHOT`.
  - `jdwp.ts` — hand-rolled JDWP handshake + DDMS chunks (`VULW` window list, `VURT` view dump). Resumes the VM after attaching so the UI keeps running.
  - `viewdump.ts` — decodes the binary `ViewDebug.dumpv2` stream (string-key table, nested maps), maps API-33 property names with legacy aliases, accumulates absolute coordinates through scroll/translation, applies `clipChildren`, assigns refs/paths, and serializes nodes. Shared helpers (`flattenNodes`, `assignRefs`, `intersect`, `serializeNode`) live here.
  - `semantics.ts` — parses uiautomator XML into `UiNode`s, then `assignRefs(..., "s")`.
  - `dumpsys.ts` — parses `dumpsys activity <pkg>`: the indentation-based `View Hierarchy` tree (real View classes, resource ids, absolute window bounds, positional flag string) and `Active Fragments` records. `assignRefs(..., "d")`. Carries no text, so `--source dumpsys` also captures semantics and `mergeSemanticsText` joins them by geometry — windows vs screen coordinates differ by the status bar, so the offset is measured (median of text-node top deltas, capped at 10% of screen height) instead of hard-coded, and only unique same-family class matches merge. `notableFragments` filters AndroidX `ReportFragment`/`LifecycleDispatcher` bookkeeping.
  - `compose.ts` — locates Android Studio (explicit/env → running process, cached 1h → default paths), resolves Java and the Compose inspector JAR (downloads/caches ~1.8.3 by default), lazily compiles `helper/src/aui/ComposeInspectorHelper.java` with the matching `javac` and caches by Studio build + source hash + compiler, stages transport/JVMTI artifacts and a resident daemon in `/data/local/tmp/aui-compose`, then runs the Java helper and converts its JSON to `UiNode`s. `compose-clean` tears down device artifacts.
  - `helper/src/aui/ComposeInspectorHelper.java` — standalone gRPC bridge against Android Studio's shaded protobuf/gRPC classes. A compiled fallback JAR is committed at `helper/aui-compose-helper.jar`; `npm run build:helper` regenerates it.
- Query/reporting:
  - `query.ts` — `findNodes` (text/desc/id/class/ref, contains/exact/regex), `hitTest` (all nodes at a point sorted by smallest visible area, then depth, then draw order), paths/summaries.
  - `analyze.ts` — layout/accessibility rules (`small_touch_target`, `overlap`, `clipped`, `outside_parent`, `offscreen`, `invisible_clickable`, `zero_size`, `unlabeled_clickable`, `duplicate_id`, `deep_nesting`, `overdraw`, `rtl_issues`). `overdraw` and `rtl_issues` read raw View properties, so `analyze` requests them by default (`--no-props` opts out) and reports them under `skipped` when the capture had none.
  - `render.ts` — human-readable tree and issue output.
  - `screenshot.ts` — PNG capture, pure-JS box-filter downscale, coordinate mapping (`imageToDevice`), and SVG annotation overlay.
  - `serialize.ts` — dump format v1 (`version: 1`), written by `saveDump`; the on-disk artifact behind `capture-ui`.
- `src/core/index.ts` re-exports the whole core API; `src/core/version.ts` reads `package.json` at runtime.

### Error and fallback behavior

All expected failures are `AuiError` with a stable `code` and optional user-facing `hint` (`src/core/errors.ts`). On capture failure, the CLI writes a downscaled fallback screenshot and reports the path; the MCP server attaches it as image content. `--source view` requires a debuggable app; `--source semantics` works on any app.

### Code-to-source locator

`scripts/locate-code.mjs` is intentionally standalone (Node built-ins only): given text/desc/id/Compose name/file/line/class anchors, it scans an Android repo and returns ranked `file:line` candidates plus string/layout/Compose anchors. MCP `locate_code` shells out to it; the path is resolved relative to `dist/` (`../scripts/locate-code.mjs`), which is another reason the packaged layout must keep `scripts/` beside `dist/`.

## Reference docs

`README.md` (English) and `README.zh.md` (Chinese) are the authoritative user-facing documentation: full command/tool tables, source trade-offs, environment variables, plugin install flow, analysis rules, and protocol implementation notes. Keep the two in sync; `docs/*.md` holds the per-topic deep dives.
