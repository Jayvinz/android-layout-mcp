# Claude Code 插件

[English](plugin.md) | [简体中文](plugin.zh.md)

仓库根目录同时是一个 Claude Code marketplace（`jayvinz-tools`）和 plugin（`android-ui`），
把 CLI、MCP Server、UI→代码定位脚本和一套 skill/command/agent 打包在一起。它面向的典型任务是：

> “定位当前页面中的 **个人页** 按钮，以及其相关代码逻辑。”

## 名称对照

| 对象 | 名称 |
|---|---|
| 产品名 | `Android UI Inspector` |
| GitHub 仓库 | `Jayvinz/android-ui-inspector` |
| Marketplace | `jayvinz-tools` |
| Plugin | `android-ui` |
| npm 包名 | `android-ui-inspector`（不发布到 registry） |
| MCP server | `android-ui` |
| CLI 命令 | `android-ui` |

## 组件

| 组件 | 路径 | 作用 |
|---|---|---|
| MCP | `.claude-plugin/plugin.json` | 内联 `mcpServers`，启动 `${CLAUDE_PLUGIN_ROOT}/dist/mcp.js`，提供 `dump_ui` / `find_elements` / `locate_code` / `hit_test` / `screenshot` / `open_viewer` / `diff_ui` / `analyze_ui` / `tap` 等 |
| Skill | `skills/inspect-current-screen/` | 只看当前页面/控件、直接操作、布局/无障碍检查，以及显式触发的浏览器查看器；不追溯源码 |
| Skill | `skills/locate-ui-code/` | UI 元素 → Compose/XML 源码 → 点击/状态/业务链路的完整流程与参考资料 |
| Skill | `skills/analyze-screen-logic/` | 整页/弹窗分析：实现、ViewModel/状态、数据来源、导航、条件与副作用（只读） |
| Skill | `skills/verify-ui-change/` | 改动前后 dump、diff、规则检查、截图与交互验证 |
| Commands | `commands/locate.md`、`screen.md`、`analyze-screen.md`、`view.md`、`verify.md` | `/android-ui:locate`、`:screen`、`:analyze-screen`、`:view`、`:verify` |
| Agent | `agents/ui-code-locator.md` | 只读的 UI→代码定位子代理，适合把多步排查隔离在子上下文 |
| Hook | `hooks/hooks.json` + `hooks/aui-android-gate.mjs` | `PreToolUse` Android 工程门槛，拦截 `get_state`/`dump_ui`/`find_elements`/`locate_code`/`open_viewer`；安装或更新插件后需重启 Claude Code |
| Script | `scripts/locate-code.mjs` | 纯 Node 内置模块的代码锚点扫描器，不需要先 `npm install` |
| Marketplace | `.claude-plugin/marketplace.json` | `jayvinz-tools` 目录；仓库根目录的第一个插件就是本项目 |

## 安装

前置：Node.js ≥ 20、`adb` 可用；Compose JVMTI 还需要 Android Studio 和可调试 App。
Claude Code 需要能从 PATH 调用 `node` / `npm`。

**从 GitHub marketplace 安装**（推荐给其他用户）：

```text
/plugin marketplace add Jayvinz/android-ui-inspector
/plugin install android-ui@jayvinz-tools
```

仓库根目录同时是 marketplace 和第一个插件：`.claude-plugin/marketplace.json` 里 `source: "./"`，
插件名 `android-ui`，marketplace 名 `jayvinz-tools`。
包名是 `android-ui-inspector`，但不会发布到 npm registry：请安装插件，或在本地克隆后 `npm link`。两种情况 CLI 命令都是 `android-ui`。

GitHub 安装时 Claude Code 会把插件复制到缓存，并根据 `package.json` +
`package-lock.json` 自动安装 Node 依赖（无 lifecycle scripts、60 秒超时）。因此仓库里
必须提交 `dist/`，`node_modules/` 不提交到仓库——发布插件包会自带一份生产依赖（见[插件包](#插件包)）。

**安装 Release 插件包**（无需克隆、无需 marketplace）。每个 GitHub Release 都附带一个从 tag 对应 commit 构建的自包含插件 zip；从 Release 页面下载 `android-ui-inspector-<version>.zip` 后加载：

```bash
claude --plugin-dir ./android-ui-inspector-<version>.zip
# 或直接指向 release 资产 URL
claude --plugin-url <release-asset-url>
```

包内已包含构建好的 `dist/`、helper jar 和生产依赖 `node_modules/`，无需再编译或安装：离线可用，也适用于会话级的 `--plugin-dir`/`--plugin-url` 加载（这条路径 Claude Code 不会代装依赖）。加载 `.zip` 需要支持 zip 插件的 Claude Code 版本；版本过旧时请改用 marketplace 安装。完整内容清单见[插件包](#插件包)。

**本地开发/调试**：

```bash
npm install
npm run build
```

```text
/plugin marketplace add E:/repo/android-ui-inspector
/plugin install android-ui@jayvinz-tools
```

（如果本地目录不同，把 `E:/repo/android-ui-inspector` 换成实际路径。）

从**本地路径**添加的 marketplace 会原地加载插件，不会自动在源码目录安装依赖，所以先执行
上面的 `npm install && npm run build`。

或只在当前会话加载：

```bash
claude --plugin-dir E:/repo/android-ui-inspector
```

安装后 `/mcp` 应能看到 `android-ui` server；`/help` 中会出现
`/android-ui:locate`、`:screen`、`:analyze-screen`、`:view`、`:verify`。

## 典型流程

以“定位当前页面中的 个人页 按钮，以及其相关代码逻辑”为例：

1. `get_state` 确认前台包、Activity、屏幕与 pid；
2. `dump_ui(source="auto", format="tree")` 得到 `uiKind` 和节点；
3. Compose 页面追加 `dump_ui(source="compose")`，取得 Composables 的 `file:line`；
4. `find_elements` / `hit_test` 锁定目标，记录 text/id/bounds/clickable；
5. `locate_code`（或直接运行定位脚本）得到字符串、布局、Compose、ViewBinding、点击处理等候选；
6. 打开候选文件验证，追 1–3 跳业务链路，输出带 `file:line` 的报告。

“抓取当前页面布局”“看下这个按钮”“有没有重叠”这类关于当前页面或可见控件的自然语言请求会走
`inspect-current-screen` skill：`get_state` → `dump_ui(format="tree")` → `find_elements` /
`hit_test`，必要时再看 `analyze_ui` 和 `screenshot`。这条路径只做设备取证，不会调用
`locate_code`；只有用户明确追问源码时才进入上面的定位流程。

整页/弹窗请求（“分析当前界面的代码和业务逻辑”“分析这个弹窗的数据从哪来”）会走
`analyze-screen-logic`：抓屏（`get_state` + `dump_ui(auto, tree)`）→ 判断页面/弹窗/底部弹层并列出区块
（独立窗口时按窗口 dump）→ 确定 Activity/Fragment/Composable/route/弹窗类 → 区块映射到 `file:line`
→ 追 ViewModel/状态 → Repository/API/缓存 1–3 跳，每一跳标注 confirmed 或 inferred。全程只读，不修改代码。

显式可视化请求（“打开可视化看看”“在浏览器里打开当前页面”“open the UI viewer”）走
`/android-ui:view` 或 `open_viewer` 工具：抓取一次、生成一个自包含的
`.aui/viewer.html`，再打开默认浏览器。`dump`/`find`/`analyze`/`screenshot`/验证流程都不会打开浏览器。

**Android 工程门槛。** 所有激活路径都会先确认当前工作目录（或用户指定的仓库根目录）是 Android 工程：
`settings.gradle(.kts)`、`gradlew(.bat)`、应用 `com.android.*` 的模块 `build.gradle(.kts)`，或
`AndroidManifest.xml`。在非 Android 仓库中，只有用户明确要求查看设备页面/界面或明确提到 Android
时才会激活；连接了设备并不代表仓库是 Android 工程。`PreToolUse` hook 会对
`get_state`/`dump_ui`/`find_elements`/`locate_code`/`open_viewer` 强制执行同一门槛；安装或更新后需重启 Claude Code。

也可以直接调用命令：

```text
/android-ui:locate 个人页
/android-ui:screen
/android-ui:analyze-screen
/android-ui:view
/android-ui:verify
```

## 定位脚本

```bash
node scripts/locate-code.mjs --root . \
  --text "个人页" \
  --desc "打开个人中心" \
  --id "profile_tab" \
  --compose-name "ProfileTab" \
  --compose-file "ProfileScreen.kt" \
  --compose-line 120 \
  --class "ProfileEntryView" \
  --json
```

- `anchors`：文本命中的 `string` 资源、规范化 id、Compose 定义；
- `candidates`：按分数排序的 `file:line`，`kind` 包括 `compose-definition`、
  `layout-id`、`layout-include-chain`、`binding-usage`、`string-usage-compose`、
  `click-handler` 等；
- 默认排除 `build/`、`.gradle/`、`generated/`、`node_modules/` 和测试代码；
  可用 `--exclude` / `--include-tests` 调整；
- `--compose-file` + `--compose-line` 会解析到该行所在的 `@Composable` 定义并列出调用点；
  若报告行实际是调用点，用名称确认定义，不要仅凭行号断言。

脚本只负责“候选排序”，最终结论仍需打开文件确认；它不会修改仓库。

## Agent

`ui-code-locator` 是只读子代理，适合让子上下文完成“抓屏 → 找节点 → 扫描候选 → 读代码”的
多步工作，主会话只接收结论。它默认不执行编辑、构建、安装或点击。

## 环境变量

插件 manifest 的 `mcpServers` 默认不注入环境变量，MCP 进程继承用户 shell 环境；需要固定
serial/adb/Studio 参数时，优先用环境变量，或在项目级 `.mcp.json` 中单独启动一份 server。
完整变量表见 [cli.zh.md](cli.zh.md#环境变量)。

## 只读与权限

- Skills/agent 默认只读；`tap`/`swipe`/`input_text` 是显式交互工具，由用户请求触发。
- 定位/验证过程会在仓库内写 `.aui/before.json`、`.aui/after.json`、`.aui/*.png`；
  建议把 `.aui/` 加入 `.gitignore`（本仓库已加入）。
- 不要提交 dump：其中可能包含设备序列号、前台包名和界面文本。

## 以后添加第二个插件

当前项目是 marketplace 的第一个插件，`source` 指向仓库根目录。以后新增插件时：

```text
android-ui-inspector/
├── .claude-plugin/
│   ├── marketplace.json       # jayvinz-tools 目录
│   └── plugin.json            # 第一个插件 android-ui
├── plugins/
│   └── another-plugin/
│       └── .claude-plugin/plugin.json
```

在 `.claude-plugin/marketplace.json` 的 `plugins` 数组里追加：

```json
{
  "name": "another-plugin",
  "source": "./plugins/another-plugin",
  "description": "..."
}
```

入口 `name` 必须与 `plugins/another-plugin/.claude-plugin/plugin.json` 的 `name` 一致。
新增后运行：

```bash
claude plugin validate --strict .
```

## 发布与校验

- marketplace 和插件都托管在同一个 GitHub 仓库；推送后用户即可
  `/plugin marketplace add <owner>/<repo>` 安装，无需任何审核。
- 仓库约定为 `Jayvinz/android-ui-inspector`；如果 GitHub owner/repo 不同，同步修改
  `marketplace.json` 的 `owner.url`、`plugin.json` 的 `homepage`/`repository`
  和 README 中的安装命令。
- 发布前运行 `claude plugin validate --strict .`；CI 工作流
  `.github/workflows/validate.yml` 会跑 typecheck、测试、build，并验证
  `dist/` 与源码一致，最后执行同一校验。
- 想进一步进入 Anthropic 官方目录：在 `claude.ai/directory/manage` 提交 Plugin bundle，
  需要付费 claude.ai 计划、GitHub 仓库、自动校验和安全扫描，新 listing 还会经过人工审核；
  `claude-plugins-official` 本身不接受公开投稿。

## 版本号

`package.json` 是版本号的唯一来源。Claude Code 需要 `.claude-plugin/plugin.json`
里的字面 `version`，所以用 `scripts/sync-version.mjs` 同步：

```bash
npm version patch    # 更新 package.json / package-lock；lifecycle 自动写入 plugin.json 并 git add
npm version minor
npm version major
```

如果不使用 `npm version`，手动同步：

```bash
node scripts/sync-version.mjs
```

CI 会运行这个检查：

```bash
node scripts/sync-version.mjs --check
```

版本不一致时 CI 会直接失败，不需要再手动改两份文件。

### 发布

推送 `v*` 形式的 tag 会触发 `.github/workflows/release.yml`：它先校验 tag 与 `package.json` 版本一致，再跑与 validate 相同的检查（版本同步检查、typecheck、测试、build、`dist/` 校验），最后用自动生成的发布说明创建 GitHub Release。

```bash
npm version 1.0.0 --no-git-tag-version   # 更新 package.json、package-lock.json、plugin.json
npm run typecheck && npm test && npm run build
git commit -am "chore: release v1.0.0"
git tag -a v1.0.0 -m "v1.0.0"
git push origin main v1.0.0
```

发布到 npm 仍是独立的手动步骤：`npm publish`（`prepublishOnly` 会先跑版本检查、typecheck、测试和 build）。

### 插件包

release workflow 还会构建 `dist-plugin/android-ui-inspector-<version>.zip` 并附加到 GitHub Release。压缩包根目录就是插件目录（`.claude-plugin/plugin.json`、`dist/`、`helper/`、`hooks/`、`skills/`、`commands/`、`agents/`、`scripts/locate-code.mjs`、`package.json`、`package-lock.json`、生产依赖 `node_modules/`、`README.md`、`README.zh.md`、`LICENSE`、`NOTICE`），可直接作为插件加载，无需解压；开发用文件（`src/`、`docs/`、`test/`、`evals/`、CI 配置、dev 依赖）不会打包进去：

```bash
claude --plugin-dir ./android-ui-inspector-<version>.zip
claude --plugin-url <release-asset-url>
```

依赖是刻意打包进去的。Claude Code 只在把插件复制进缓存时安装 npm 依赖，且要求插件根目录同时有 `package.json` 和支持的 lockfile；通过 `--plugin-dir`/`--plugin-url` 加载的 `.zip` 只会解压到会话临时目录，不会触发安装。因此包内附带生产 `node_modules/`（压缩后约 6 MB，纯 JS、无原生模块），保证所有加载路径都可用；lockfile 则让后续的缓存安装能复现同一套依赖。

本地构建用 `npm run build:plugin-zip`，它会在临时目录执行 `npm ci --omit=dev`（需要 registry 网络，约 10s）。离线构建可加 `--no-deps`：产物约 190 KB，但解压后需要自行执行 `npm ci --omit=dev`。压缩包是可复现的：条目时间戳固定为 1980-01-01，可用 `SOURCE_DATE_EPOCH` 覆盖；同一 commit 总是产出同一个文件。`--root <dir>` 可以打包另一棵树，发布资产就是据此从 tag 对应的 commit 重建的。
