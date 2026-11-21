# Claude Code 插件

[English](plugin.md) | [简体中文](plugin.zh.md)

仓库根目录同时是一个 Claude Code marketplace（`jayvinz-tools`）和 plugin（`layout-inspector-android`），
把 CLI、MCP Server、UI→代码定位脚本和一套 skill/command/agent 打包在一起。它面向的典型任务是：

> “定位当前页面中的 **个人页** 按钮，以及其相关代码逻辑。”

## 名称对照

| 对象 | 名称 |
|---|---|
| GitHub 仓库 | `Jayvinz/layout-inspector-android` |
| Marketplace | `jayvinz-tools` |
| Plugin | `layout-inspector-android` |
| npm 包 | `layout-inspector-android` |
| MCP server | `layout-inspector-android` |
| CLI 命令 | `layout-inspector` |

## 组件

| 组件 | 路径 | 作用 |
|---|---|---|
| MCP | `.claude-plugin/plugin.json` | 内联 `mcpServers`，启动 `${CLAUDE_PLUGIN_ROOT}/dist/mcp.js`，提供 `dump_ui` / `find_elements` / `locate_code` / `hit_test` / `screenshot` / `diff_ui` / `analyze_ui` / `tap` 等 |
| Skill | `skills/locate-ui-code/` | UI 元素 → Compose/XML 源码 → 点击/状态/业务链路的完整流程与参考资料 |
| Skill | `skills/verify-ui-change/` | 改动前后 dump、diff、规则检查、截图与交互验证 |
| Commands | `commands/locate.md`、`screen.md`、`verify.md` | `/layout-inspector-android:locate`、`:screen`、`:verify` |
| Agent | `agents/ui-code-locator.md` | 只读的 UI→代码定位子代理，适合把多步排查隔离在子上下文 |
| Script | `scripts/locate-code.mjs` | 纯 Node 内置模块的代码锚点扫描器，不需要先 `npm install` |
| Marketplace | `.claude-plugin/marketplace.json` | `jayvinz-tools` 目录；仓库根目录的第一个插件就是本项目 |

## 安装

前置：Node.js ≥ 20、`adb` 可用；Compose JVMTI 还需要 Android Studio 和可调试 App。
Claude Code 需要能从 PATH 调用 `node` / `npm`。

**从 GitHub marketplace 安装**（推荐给其他用户）：

```text
/plugin marketplace add Jayvinz/layout-inspector-android
/plugin install layout-inspector-android@jayvinz-tools
```

仓库根目录同时是 marketplace 和第一个插件：`.claude-plugin/marketplace.json` 的
`source` 是 `"./"`，插件名 `layout-inspector-android`，marketplace 名 `jayvinz-tools`。
npm 包名是 `layout-inspector-android`；不管通过插件还是 npm 安装，CLI 命令都是 `layout-inspector`。

GitHub 安装时 Claude Code 会把插件复制到缓存，并根据 `package.json` +
`package-lock.json` 自动安装 Node 依赖（无 lifecycle scripts、60 秒超时）。因此仓库里
必须提交 `dist/`；`node_modules/` 不提交。

**本地开发/调试**：

```bash
npm install
npm run build
```

```text
/plugin marketplace add E:/repo/layout-inspector-android
/plugin install layout-inspector-android@jayvinz-tools
```

（如果本地目录不同，把 `E:/repo/layout-inspector-android` 换成实际路径。）

从**本地路径**添加的 marketplace 会原地加载插件，不会自动在源码目录安装依赖，所以先执行
上面的 `npm install && npm run build`。

或只在当前会话加载：

```bash
claude --plugin-dir E:/repo/layout-inspector-android
```

安装后 `/mcp` 应能看到 `layout-inspector-android` server；`/help` 中会出现
`/layout-inspector-android:locate`、`:screen`、`:verify`。

## 典型流程

以“定位当前页面中的 个人页 按钮，以及其相关代码逻辑”为例：

1. `get_state` 确认前台包、Activity、屏幕与 pid；
2. `dump_ui(source="auto", format="tree")` 得到 `uiKind` 和节点；
3. Compose 页面追加 `dump_ui(source="compose")`，取得 Composables 的 `file:line`；
4. `find_elements` / `hit_test` 锁定目标，记录 text/id/bounds/clickable；
5. `locate_code`（或直接运行定位脚本）得到字符串、布局、Compose、ViewBinding、点击处理等候选；
6. 打开候选文件验证，追 1–3 跳业务链路，输出带 `file:line` 的报告。

也可以直接调用命令：

```text
/layout-inspector-android:locate 个人页
/layout-inspector-android:screen
/layout-inspector-android:verify
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
- 定位/验证过程会在仓库内写 `.dli/before.json`、`.dli/after.json`、`.dli/*.png`；
  建议把 `.dli/` 加入 `.gitignore`（本仓库已加入）。
- 不要提交 dump：其中可能包含设备序列号、前台包名和界面文本。

## 以后添加第二个插件

当前项目是 marketplace 的第一个插件，`source` 指向仓库根目录。以后新增插件时：

```text
layout-inspector-android/
├── .claude-plugin/
│   ├── marketplace.json       # jayvinz-tools 目录
│   └── plugin.json            # 第一个插件 layout-inspector-android
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
- 仓库约定为 `Jayvinz/layout-inspector-android`；如果 GitHub owner/repo 不同，同步修改
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

`prepublishOnly` 和 CI 都会运行：

```bash
node scripts/sync-version.mjs --check
```

版本不一致时发布会或 CI 直接失败，不需要再手动改两份文件。
