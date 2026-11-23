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

npm run build:helper   # rebuild helper/dli-compose-helper.jar against the local Android Studio
node scripts/sync-version.mjs          # sync package.json version -> .claude-plugin/plugin.json
node scripts/sync-version.mjs --check  # CI/release check
npm version patch      # bumps package.json and syncs plugin.json via the "version" lifecycle script
claude plugin validate --strict .      # validate plugin + marketplace manifests
claude plugin eval . --case 'trigger-*' --runs 1 --ablation none --trust-plugin --no-publish --max-cost-usd 4  # mocked activation regression, no device
```

Tests are fixture-based (`test/fixtures/`) and need no device. The fixtures are real API 33 captures: a Compose app's `ViewDebug.dumpv2` binary, an XML app's binary, uiautomator XML, a screenshot, and Compose helper JSON.

`evals/` holds mocked activation regression cases (`prompt.md` + `graders/*.md`). They assert skill/tool selection, not code output; `evals/mocks/` replaces the MCP server, so no device is needed. `evals/mocks/layout-inspector-android/_tools.json` is a saved `tools/list` snapshot; regenerate it after changing tool descriptions in `src/mcp.ts` and rebuilding `dist/`. They are not part of CI because they run real Claude Code sessions and cost tokens.

## Language conventions

- Write code comments, documentation prose, and commit messages in English by default.
- When adding or updating user-facing documentation, also provide an English section (or a linked English version) alongside any Chinese content. Do not create new Chinese-only docs.
- Skill bodies are English. Skill `description` frontmatter is the exception: keep the English trigger description and append the Chinese trigger phrases users actually type, so Chinese requests still activate the skill.
- Keep CLI flags, command examples, identifiers, and file paths identical across languages; translate only the surrounding prose.

User-facing docs come in parallel language versions that link to each other: `README.md` (English) and `README.zh.md` (Chinese), plus `docs/*.md` (English) with `docs/*.zh.md` (Chinese counterparts). Keep both sides in sync when content changes.

## Critical build/packaging constraints

- **`dist/` is intentionally committed.** GitHub marketplace installs copy the repo and start the MCP server from `dist/mcp.js`; `node_modules/` is not committed. CI runs `git diff --exit-code -- dist`, so after changing anything in `src/`, run `npm run build` and commit the regenerated `dist/` (and `dist/*.d.ts`) in the same change. Never hand-edit `dist/`.
- **`package.json` is the only version source.** `.claude-plugin/plugin.json` needs a literal version; `scripts/sync-version.mjs` keeps them equal. `prepublishOnly` and CI fail on mismatch.
- The repository is simultaneously an npm package (`layout-inspector-android`, binary `layout-inspector`) and a Claude Code plugin + marketplace:
  - `.claude-plugin/plugin.json` — plugin `layout-inspector-android`; inline `mcpServers` launches `${CLAUDE_PLUGIN_ROOT}/dist/mcp.js`.
  - `.claude-plugin/marketplace.json` — marketplace `jayvinz-tools`, with `source: "./"` (repo root is the first plugin).
  - `skills/`, `commands/`, `agents/` are shipped plugin components. `scripts/locate-code.mjs` is dependency-free so it works before `npm install`.
- The module system is ESM (`"type": "module"`, TypeScript `NodeNext`): relative imports in `src/` must use the `.js` extension, even when importing a `.ts` file.
- CI (`.github/workflows/validate.yml`) runs, in order: `sync-version --check`, typecheck, tests, build, `git diff --exit-code -- dist`, then `claude plugin validate --strict .`.
- Do not commit dumps or screenshots: they contain device serials, package names, and screen text. `.dli/`, `dli-fallback-*.png`, and `*.annotated.svg` are gitignored.

## Architecture

Two front ends, one core:

```
src/cli.ts (commander) ─┐
                        ├── src/core/* ─── adb / device
src/mcp.ts (MCP stdio) ─┘        ├── view  : JDWP + DDMS ViewDebug v2 (View properties)
                                 ├── semantics : adb uiautomator XML (Compose text/controls)
                                 └── compose : Android Studio transport + JVMTI + helper JAR
```

- `src/cli.ts` and `src/mcp.ts` are thin wrappers. Keep them in parity: a new inspection capability normally means a core function, a CLI subcommand, and an MCP tool. Both call the same `capture()` and `treesFor()` so behavior does not diverge.
- Activation boundaries live in the skill frontmatter descriptions: `inspect-current-screen` owns screen/control observation and must not call `locate_code`; `locate-ui-code` owns one-control source/state/business tracing and page entry; `analyze-screen-logic` owns whole-screen/dialog code, state, data-flow, and business-chain analysis (read-only); `verify-ui-change` owns before/after verification. The explicit browser viewer (`open_viewer` / `view`) belongs to `inspect-current-screen` and activates only on an explicit visual request. Keep each description under 1024 characters and preserve the Chinese trigger phrases users actually type; `test/skills.test.ts` guards them.
- All four skills, the commands, the `ui-code-locator` agent, and the `get_state`/`dump_ui`/`find_elements`/`locate_code`/`open_viewer` MCP descriptions carry the Android-project gate: activation targets Android projects (`settings.gradle(.kts)`, `gradlew`, a module applying `com.android.*`, or `AndroidManifest.xml`). In a non-Android repository, activate only on an explicit device/screen request or an explicit Android mention; a connected device does not make the repository Android.
- The gate is enforced twice: hard-stop prose in every skill/command body and a `PreToolUse` hook (`hooks/hooks.json` + `hooks/dli-android-gate.mjs`) that denies `get_state`/`dump_ui`/`find_elements`/`locate_code`/`open_viewer` in a non-Android workspace unless the latest user prompt explicitly asks about a device screen/page or Android; `locate_code` additionally requires an Android project or an explicit Android mention. `claude plugin eval` does not load plugin hooks, so the hook is unit-tested in `test/android-gate.test.ts` and the non-Android refusal prompts live under `evals/manual-gate-*` (outside the `trigger-*` glob). Hooks load at session start; restart after install/update.
- `src/core/capture.ts` orchestrates everything: resolves device/foreground app/pid, captures the requested trees, classifies the screen (`classifyUi`: `xml` / `compose` / `mixed` / `unknown`), picks the primary source for `auto`, and returns one `CaptureResult`. `treesFor(result, source, both)` is the single source-to-trees policy shared by CLI and MCP.
  - `auto` captures view + semantics, then chooses view for XML, semantics for Compose (ViewDebug stops at `AndroidComposeView`), and renders/searches both for mixed screens.
  - `compose` is opt-in (`--source compose`) because it requires a debuggable app, Android Studio, Java, and takes ~8–12s.
- `src/core/model.ts` defines the normalized tree. Every source produces the same `UiNode` shape, with `source`, `ref` (`v*` view, `s*` semantics, `c*` compose), raw `bounds`, clipped `visibleBounds`, `center`, and source-specific extras (`view` or `compose`). `ref`/`id` are valid only for one capture.
- Source implementations:
  - `adb.ts` — ADB wrapper (device list, screen info, foreground app, pid lookup, input, screenshot, port forwards). Respects `DLI_ADB`/`ADB_PATH`, `ANDROID_SERIAL`, `DLI_JAVA`, `DLI_ANDROID_STUDIO`, `DLI_COMPOSE_VERSION`, `DLI_COMPOSE_INSPECTOR_JAR`, `DLI_NO_FALLBACK_SCREENSHOT`.
  - `jdwp.ts` — hand-rolled JDWP handshake + DDMS chunks (`VULW` window list, `VURT` view dump). Resumes the VM after attaching so the UI keeps running.
  - `viewdump.ts` — decodes the binary `ViewDebug.dumpv2` stream (string-key table, nested maps), maps API-33 property names with legacy aliases, accumulates absolute coordinates through scroll/translation, applies `clipChildren`, assigns refs/paths, and serializes nodes. Shared helpers (`flattenNodes`, `assignRefs`, `intersect`, `serializeNode`) live here.
  - `semantics.ts` — parses uiautomator XML into `UiNode`s, then `assignRefs(..., "s")`.
  - `compose.ts` — locates Android Studio (explicit/env → running process, cached 1h → default paths), resolves Java and the Compose inspector JAR (downloads/caches ~1.8.3 by default), lazily compiles `helper/src/dli/ComposeInspectorHelper.java` with the matching `javac` and caches by Studio build + source hash + compiler, stages transport/JVMTI artifacts and a resident daemon in `/data/local/tmp/dli-compose`, then runs the Java helper and converts its JSON to `UiNode`s. `compose-clean` tears down device artifacts.
  - `helper/src/dli/ComposeInspectorHelper.java` — standalone gRPC bridge against Android Studio's shaded protobuf/gRPC classes. A compiled fallback JAR is committed at `helper/dli-compose-helper.jar`; `npm run build:helper` regenerates it.
- Query/reporting:
  - `query.ts` — `findNodes` (text/desc/id/class/ref, contains/exact/regex), `hitTest` (all nodes at a point sorted by smallest visible area, then depth, then draw order), paths/summaries.
  - `analyze.ts` — layout/accessibility rules (`small_touch_target`, `overlap`, `clipped`, `outside_parent`, `offscreen`, `invisible_clickable`, `zero_size`, `unlabeled_clickable`, `duplicate_id`, `deep_nesting`).
  - `render.ts` — human-readable tree and issue output.
  - `screenshot.ts` — PNG capture, pure-JS box-filter downscale, coordinate mapping (`imageToDevice`), and SVG annotation overlay.
- `viewer.ts` — self-contained interactive HTML viewer: serialized per-source trees with max-node counters, downscaled screenshot data URI, details, analysis issues, 8 MB embedded-JSON budget, and an offline document (inline CSS/JS, CSP, no network). Browser launch is explicit-only (`layout-inspector view` / MCP `open_viewer` / `DLI_NO_OPEN=1`); dump/find/analyze/screenshot/verify must never call it.
  - `serialize.ts` / `diff.ts` — dump format v1 (`version: 1`) and identity-keyed added/removed/changed diff. `chooseDiffSource` avoids comparing different trees in before/after dumps.
- `src/core/index.ts` re-exports the whole core API; `src/core/version.ts` reads `package.json` at runtime.

### Error and fallback behavior

All expected failures are `DliError` with a stable `code` and optional user-facing `hint` (`src/core/errors.ts`). On capture failure, the CLI writes a downscaled fallback screenshot and reports the path; the MCP server attaches it as image content. `--source view` requires a debuggable app; `--source semantics` works on any app.

### Code-to-source locator

`scripts/locate-code.mjs` is intentionally standalone (Node built-ins only): given text/desc/id/Compose name/file/line/class anchors, it scans an Android repo and returns ranked `file:line` candidates plus string/layout/Compose anchors. MCP `locate_code` shells out to it; the path is resolved relative to `dist/` (`../scripts/locate-code.mjs`), which is another reason the packaged layout must keep `scripts/` beside `dist/`.

## Reference docs

`README.md` (English overview + full Chinese sections) is the authoritative user-facing documentation: full command/tool tables, source trade-offs, environment variables, plugin install flow, analysis rules, and protocol implementation notes.
