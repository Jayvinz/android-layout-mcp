# 开发与实现说明

[English](development.md) | [简体中文](development.zh.md)

## 开发命令

```bash
npm test          # 基于真实设备抓取 fixture 的单元测试
npm run typecheck
npm run build     # 重新生成 dist/（dist/ 有意提交到仓库）
npm run build:helper   # 使用本机 Android Studio 重新编译 Compose JVMTI helper
npm run build:plugin-zip   # 构建发布用插件包到 dist-plugin/（已 gitignore；会执行 npm ci --omit=dev，离线可加 --no-deps）
npm run sync-skills        # 把 4 个技能复制到 .agents/skills 供其他 agent 使用（--codebuddy、--workbuddy、--both、--global、--check）
npx tsx --test test/query.test.ts   # 运行单个测试文件
npx tsx src/cli.ts dump             # 不构建直接从源码运行 CLI
```

测试 fixture 位于 `test/fixtures/`：API 33 的 `ViewDebug.dumpv2` 二进制（Compose 应用一份、
传统 XML View 应用一份）、uiautomator XML、截图，以及 Compose JVMTI helper 的树输出 JSON。

## 激活、查看器与门禁测试

- `test/skills.test.ts` 守护四个 skill 描述（1024 字符上限、中文触发词、Android 门禁、路由边界）以及 command/agent 文案。
- `test/viewer.test.ts` 覆盖自包含 HTML 查看器、payload 上限、转义、缺失截图与浏览器启动开关。
- `test/android-gate.test.ts` 覆盖 `PreToolUse` Android 工程 hook。

`evals/` 是无设备的 mock 路由用例：`trigger-*` 测 skill/tool 选择，`scaffold-android-workspace-analyze` 用 `--scaffold` 测真实 Android 工作区，`manual-gate-*` 测非 Android 拒绝。命令与成本见 [evals/README.md](../evals/README.md)。评测环境不加载插件 hooks；修改 `hooks/` 后需重启 Claude Code。

```bash
claude plugin eval . --case 'trigger-*' --runs 1 --ablation none --trust-plugin --no-publish --max-cost-usd 6
claude plugin eval . --case 'scaffold-android-workspace-analyze' --scaffold --runs 1 --ablation none --trust-plugin --no-publish --max-cost-usd 2
```

## 构建与打包约束

- **`dist/` 有意提交**：GitHub marketplace 安装会复制仓库并直接从 `dist/mcp.js` 启动
  MCP server，`node_modules/` 不提交。修改 `src/` 后请运行 `npm run build` 并把重新生成的
  `dist/`（含 `dist/*.d.ts`）随源码一起提交；不要手改 `dist/`。
- **版本号唯一来源是 `package.json`**：`scripts/sync-version.mjs` 把版本同步到
  `.claude-plugin/plugin.json`；`npm version patch` 会自动触发同步。详见
  [plugin.zh.md](plugin.zh.md#版本号)。
- 仓库同时是 npm 包（`android-ui-inspector`，二进制 `android-ui`）和
  Claude Code plugin + marketplace（`jayvinz-tools`）。
- `npm run build:plugin-zip` 会把发布用插件包写到 `dist-plugin/android-ui-inspector-<version>.zip`；它是构建产物，已在 `.gitignore` 中。构建时会在临时目录执行 `npm ci --omit=dev`（需要 registry 网络；`--no-deps` 可跳过），使包内自带生产 `node_modules/` 与 `package-lock.json`，这样以 `--plugin-dir`/`--plugin-url` 会话级加载时也能直接运行（该路径不会自动安装依赖）。release workflow 会构建它、校验解压后的包，并附加到 GitHub Release（见 [plugin.zh.md](plugin.zh.md#插件包)）。
- 模块系统为 ESM（TypeScript `NodeNext`）：`src/` 内相对导入必须带 `.js` 扩展名。
- `PreToolUse` Android 工程门禁位于 `hooks/hooks.json` + `hooks/aui-android-gate.mjs`；hook 只在会话启动时加载，修改后需重启 Claude Code。
- Compose helper 源码在 `helper/src/aui/ComposeInspectorHelper.java`，提交的构建产物是 `helper/aui-compose-helper.jar`；`npm run build:helper` 会针对本机 Android Studio 重新生成该 jar。
- 预期内的失败统一抛 `AuiError`（`src/core/errors.ts`），带稳定的 `code` 和可选的用户提示 `hint`。
- 不要提交 dump 或截图：它们可能包含设备序列号、包名和界面文本。
  `.aui/`、`aui-fallback-*.png`、`*.annotated.svg` 已在 `.gitignore` 中。

## 实现说明

### 视图树（与 LayoutInspectorV2-Pro 相同）

1. `adb shell pidof <pkg>` 找到可调试进程；
2. `adb forward tcp:0 jdwp:<pid>` 建立 JDWP 连接并完成 `JDWP-Handshake`；
3. 发送 DDM chunk（JDWP command set `0xC7`）：
   - `VULW` 列出 `ViewRootImpl` 窗口；
   - `VURT`（op=1）请求 `ViewDebug.dumpv2` 二进制视图树；
4. 解码 `ViewHierarchyEncoder` 格式（short key map + 末尾字符串表），映射 API 33 的
   `layout:left` / `misc:visibility` / `drawing:translationX` 等属性，同时兼容旧版 `mLeft` 等命名；
5. 沿父链累加 `left/top - parent.scrollX + translation` 得到屏幕坐标，并按 `clipChildren`
   与滚动容器计算 `visibleBounds`。

命中测试沿用插件的策略：收集落在坐标内的所有节点，按**可见面积升序**排序，面积相同则更深/后绘制的优先。

### 语义树

`adb shell uiautomator dump` → 解析 `<node>` 层级。它在 Compose 应用中能拿到
`TextView`/`Button`/`content-desc`/`clickable` 等真实交互信息，是 view 树的有效补充。

### Compose 树

Compose 树通过独立的 Java helper（`helper/src/aui/ComposeInspectorHelper.java`）桥接
Android Studio 自带的 transport/JVMTI/inspector 工件，输出 JSON 后转换为统一的节点树。
设备侧细节、缓存策略与前置条件见 [data-sources.zh.md](data-sources.zh.md#compose-jvmti-树android-studio-级)。
