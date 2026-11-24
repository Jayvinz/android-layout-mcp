# Development

[English](development.md) | [简体中文](development.zh.md)

## Development commands

```bash
npm test          # fixture-based unit tests from real device captures
npm run typecheck
npm run build     # regenerates dist/ (dist/ is intentionally committed)
npm run build:helper   # rebuild the Compose JVMTI helper against local Android Studio
npx tsx --test test/query.test.ts   # run a single test file
npx tsx src/cli.ts dump             # run the CLI from source without building
```

Test fixtures live in `test/fixtures/`: API 33 `ViewDebug.dumpv2` binaries (one Compose app, one traditional XML View app), uiautomator XML, a screenshot, and the Compose JVMTI helper's tree output JSON.

## Activation, viewer, and gate tests

- `test/skills.test.ts` guards the four skill descriptions (1024-character limit, Chinese triggers, Android gate, routing boundaries) and the command/agent copy.
- `test/viewer.test.ts` covers the self-contained HTML viewer, payload caps, escaping, missing screenshots, and browser-launch opt-out.
- `test/android-gate.test.ts` covers the `PreToolUse` Android-project hook.

`evals/` contains mocked routing cases (no device): `trigger-*` for skill/tool selection, `scaffold-android-workspace-analyze` for a real Android workspace (`--scaffold`), and `manual-gate-*` for non-Android refusal. See [evals/README.md](../evals/README.md) for commands and costs. The eval harness does not load plugin hooks; restart Claude Code after changing `hooks/`.

```bash
claude plugin eval . --case 'trigger-*' --runs 1 --ablation none --trust-plugin --no-publish --max-cost-usd 6
claude plugin eval . --case 'scaffold-android-workspace-analyze' --scaffold --runs 1 --ablation none --trust-plugin --no-publish --max-cost-usd 2
```

## Build and packaging constraints

- **`dist/` is intentionally committed**: GitHub marketplace installs copy the repository and start the MCP server from `dist/mcp.js` without a build step; `node_modules/` is not committed. After changing `src/`, run `npm run build` and commit the regenerated `dist/` (including `dist/*.d.ts`) together with the source; never hand-edit `dist/`.
- **`package.json` is the only version source**: `scripts/sync-version.mjs` syncs the version into `.claude-plugin/plugin.json`; `npm version patch` triggers the sync automatically. See [plugin.md](plugin.md#versioning).
- The repository is both an npm package (`android-ui-inspector`, binary `android-ui`) and a Claude Code plugin + marketplace (`jayvinz-tools`).
- The module system is ESM (TypeScript `NodeNext`): relative imports in `src/` must use the `.js` extension.
- The `PreToolUse` Android-project gate lives in `hooks/hooks.json` + `hooks/aui-android-gate.mjs`; hooks load at session start, so restart Claude Code after changing them.
- The Compose helper source is `helper/src/aui/ComposeInspectorHelper.java` and the committed build is `helper/aui-compose-helper.jar`; `npm run build:helper` regenerates the jar against the local Android Studio.
- Expected failures are thrown as `AuiError` from `src/core/errors.ts` with a stable `code` and an optional user-facing `hint`.
- Do not commit dumps or screenshots: they may contain device serials, package names, and screen text. `.aui/`, `aui-fallback-*.png`, and `*.annotated.svg` are already in `.gitignore`.

## Implementation notes

### View tree (same as LayoutInspectorV2-Pro)

1. `adb shell pidof <pkg>` finds the debuggable process;
2. `adb forward tcp:0 jdwp:<pid>` opens a JDWP connection and completes the `JDWP-Handshake`;
3. Send DDM chunks (JDWP command set `0xC7`):
   - `VULW` lists `ViewRootImpl` windows;
   - `VURT` (op=1) requests the `ViewDebug.dumpv2` binary view tree;
4. Decode the `ViewHierarchyEncoder` format (short key map + trailing string table), mapping API 33 property names such as `layout:left` / `misc:visibility` / `drawing:translationX` while staying compatible with legacy names like `mLeft`;
5. Accumulate `left/top - parent.scrollX + translation` along the parent chain for screen coordinates, and compute `visibleBounds` from `clipChildren` and scroll containers.

Hit testing follows the plugin's strategy: collect all nodes containing the coordinate, sort by **visible area ascending**, with deeper/later-drawn nodes winning ties.

### Semantics tree

`adb shell uiautomator dump` → parse the `<node>` hierarchy. In Compose apps it yields real interaction information such as `TextView`/`Button`/`content-desc`/`clickable`, an effective complement to the view tree.

### Compose tree

The Compose tree goes through a standalone Java helper (`helper/src/aui/ComposeInspectorHelper.java`) bridging Android Studio's transport/JVMTI/inspector artifacts; its JSON output is converted into the unified node tree. On-device details, caching, and prerequisites are documented in [data-sources.md](data-sources.md#compose-jvmti-tree-android-studio-level).
