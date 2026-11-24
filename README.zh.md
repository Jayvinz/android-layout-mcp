# Android Layout MCP

[English](README.md) | [简体中文](README.zh.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)
[![Node.js ≥ 20](https://img.shields.io/badge/node-%E2%89%A520-green.svg)](https://nodejs.org/)
[![CI](https://github.com/Jayvinz/android-layout-mcp/actions/workflows/validate.yml/badge.svg)](https://github.com/Jayvinz/android-layout-mcp/actions/workflows/validate.yml)

**面向 coding agent 的 Android UI 检查工具。** 通过 ADB 读取真实设备/模拟器上的实时界面，支持搜索、命中测试、带节点标注的截图、布局/无障碍检查、改码前后布局对比，并能把任意控件追溯到其 Compose/XML 源码与业务逻辑。

参考 [LayoutInspectorV2-Pro](https://plugins.jetbrains.com/plugin/21047-layoutinspectorv2-pro)。

## 核心特性

- **数据源自适应** —— `auto` 按页面选择正确的数据树：XML 用 ViewDebug v2，Compose 用无障碍语义树，混合页面两者并用；需要 Composable 名称与 `file:line` 时可显式启用 Compose JVMTI 树。
- **查找、命中测试、交互** —— 按文本 / content-description / resource-id / class / ref 搜索，解析某个坐标下的所有元素（按面积从小到大排序），然后点击、滑动或输入。
- **可视化验证** —— 截图支持 SVG 节点标注与图片坐标→设备坐标的自动映射；结构化抓取失败时会自动保存一张兜底截图。
- **按需交互式浏览器查看器** —— 说“打开可视化看看”即可生成一个自包含的离线 HTML 文件（树、截图叠加层、节点详情、布局问题）并在浏览器中打开；其他命令绝不会顺带打开浏览器。
- **检查与对比** —— 10 条布局/无障碍规则，以及围绕代码改动的 identity-keyed 改前/改后 diff。
- **UI → 源码定位** —— 以 UI 锚点扫描仓库，返回排序后的 `file:line` 候选、string/layout/Compose 定义与点击处理逻辑。全程只读，不修改仓库。
- **一个内核，两个前端** —— CLI 与 MCP server 共享同一套 `capture()` / `treesFor()` 流程，行为不会分叉。

## 命名

| 层级 | 名字 |
| --- | --- |
| GitHub 仓库 | `Jayvinz/android-layout-mcp` |
| MCP server key（所有客户端） | `android-layout` |
| CLI 命令 | `android-layout` |
| Claude Code 插件与 marketplace 条目 | `android-layout` |
| 插件显示名 | Android Layout MCP |

仓库名与 npm 包名保留 `-mcp` 后缀，CLI 命令、MCP server key 与插件名使用更短的 `android-layout`。
MCP server 与 CLI 适用于任何 MCP 客户端；Claude Code 只是受支持的前端之一，并非唯一选择。
客户端矩阵与各客户端的接入方式见[跨 agent 指南](docs/cross-agent.zh.md)。

0.1.0 是当前名字下的首个版本。此前用过的名字都从未发布，因此没有需要迁移的内容：接入客户端后
直接使用 `android-layout` 即可。在 Claude Code 中门禁 hook 只在会话启动时读取，安装或更新插件后
重启一次。

## 架构

```
CLI (android-layout) ──────┐
                               ├── core ──┬── JDWP + DDM → ViewDebug v2 视图树
MCP Server ────────────────────┘          ├── adb uiautomator → Semantics 树
                                          └── Android Studio transport + JVMTI → Compose 树
```

## 快速上手

### 前置条件

- Node.js ≥ 20（插件 / MCP / CLI 均需要）
- Android platform-tools：`adb` 在 PATH 中，或设置 `AUI_ADB` / `ADB_PATH`
- 已开启 USB 调试的设备或模拟器，目标 App 运行在前台
- `view` / `compose` 数据源要求 App 为可调试构建（`android:debuggable=true`）；`semantics` 无此要求
- 客户端需能调用 `node`（Claude Code 还需 `npm` 来安装插件）

### 1. 接入 Claude Code 插件

```text
/plugin marketplace add Jayvinz/android-layout-mcp
/plugin install android-layout@jayvinz-tools
```

安装成功后即获得：

| 组件 | 内容 |
|---|---|
| MCP server `android-layout` | `dump_ui`、`find_elements`、`locate_code`、`hit_test`、`analyze_ui`、`screenshot`、`open_viewer`、`diff_ui`、`tap` 等工具 |
| Slash 命令 | `/android-layout:locate`（UI→源码）、`:screen`（当前页面速览）、`:analyze-screen`（页面/弹窗逻辑）、`:view`（浏览器查看器）、`:verify`（真机验证改动） |
| Skills | `inspect-current-screen`、`locate-ui-code`、`analyze-screen-logic`、`verify-ui-change` |
| 只读子代理 | `ui-code-locator` |

可用 `/mcp` 确认 server 已加载，`/help` 中能看到上述命令。

不想添加 marketplace 时，每个 Release 还附带一个自包含的插件包（构建好的 `dist/`、helper jar 与生产依赖），可免克隆直接加载，详见 [docs/plugin.zh.md](docs/plugin.zh.md#插件包)：

```text
claude --plugin-dir ./android-layout-mcp-<version>.zip
```

**本地开发/调试**：先在仓库根目录执行 `npm install && npm run build`，再把 marketplace 指向本地路径（换成你自己的克隆路径）：

```text
/plugin marketplace add E:/repo/android-layout-mcp
/plugin install android-layout@jayvinz-tools
```

组件清单、发布、版本号等细节见 [docs/plugin.zh.md](docs/plugin.zh.md)。

### 2. 接入 MCP Server（其他客户端）

```bash
node dist/cli.js mcp --print-config --client cursor
```

`--client` 支持 `claude`、`claude-desktop`、`codebuddy`、`workbuddy`、`cursor`、`windsurf`、`devin`、`cline`、`kiro`、`gemini`、
`antigravity`、`qwen`、`trae`、`vscode`、`codex`、`zed`、`opencode`、`goose`、`amp`、`generic`。
它按目标客户端的格式输出（Codex 用 TOML、VS Code 用 `servers`、Zed 用 `context_servers`、Goose 用
`extensions`……），并把目标文件路径打印到 stderr。默认输出 `mcpServers` 对象：

```json
{
  "mcpServers": {
    "android-layout": {
      "command": "node",
      "args": ["E:/repo/android-layout-mcp/dist/mcp.js"]
    }
  }
}
```

支持技能加载的客户端还能复用这 4 个技能：`node scripts/sync-agent-skills.mjs --dest ../my-android-app`
会把它们写入 `.agents/skills/`；CodeBuddy 要加 `--codebuddy` 写入 `.codebuddy/skills/`，WorkBuddy 加
`--workbuddy` 写入 `.workbuddy/skills/`，`--both` 写 `.agents/skills/` 与 `.codebuddy/skills/` 两处，
再叠加 `--workbuddy` 则三处都写（Cursor 与 VS Code 直接读 `.claude/skills/`）。斜杠命令、子代理与
门禁 hook 仍然只在 Claude Code 中可用。

工具清单、参数、推荐调用顺序与[本机实测的客户端矩阵](docs/mcp.zh.md#本机实测)见
[docs/mcp.zh.md](docs/mcp.zh.md)（OpenCode、CodeBuddy Code、Codex CLI、WorkBuddy；WorkBuddy 需要
在 GUI 中一次性启用自定义 server）。

### 3. 作为 CLI 使用

```bash
npm install && npm run build
npm link                       # 提供全局 android-layout 命令

android-layout devices       # 已连接设备
android-layout state         # 屏幕、前台 App、pid
android-layout dump          # 抓取当前 UI（默认 auto）
android-layout find "开拍"   # 按文本查找
android-layout view          # 生成交互式 HTML 查看器并在浏览器中打开
```

完整命令表、分析规则、截图与坐标映射见 [docs/cli.zh.md](docs/cli.zh.md)。

### 跑通第一个任务

把目标 App 摆到想要的页面，在 Claude Code 里直接说：

> 定位当前页面中的 **个人页** 按钮，以及其相关代码逻辑。

或运行命令：

```text
/android-layout:locate 个人页
```

工具会依次：确认前台 App → 抓取 UI 树 → 锁定目标节点 → 扫描仓库得到 `file:line` 候选 → 阅读代码输出定位报告。UI 改动完成后用 `/android-layout:verify` 做改前/改后对比验证。

如果要分析的是整个页面、弹窗或底部弹层而不是单个控件，可以说“分析当前界面的代码和业务逻辑”，或运行 `/android-layout:analyze-screen`：它会把页面各区块映射到源码，再追 ViewModel、数据来源、导航与副作用。

**仅支持 Android 工程。** 激活前会确认当前目录（或用户指定的仓库根目录）是 Android 工程（`settings.gradle(.kts)`、`gradlew`、应用 `com.android.*` 的模块 `build.gradle(.kts)`，或 `AndroidManifest.xml`）。在非 Android 仓库中，只有用户明确要求查看设备页面/界面或明确提到 Android 时才会激活；连接了设备并不代表仓库是 Android 工程。`PreToolUse` hook 会对 `get_state`、`dump_ui`、`find_elements`、`locate_code`、`open_viewer` 强制执行同一门槛。Hook 在会话启动时加载，安装或更新插件后需要重启 Claude Code。

## 能做什么

| 想做的事 | 入口 |
|---|---|
| 定位控件对应的 Compose/XML 源码与业务链路 | `/android-layout:locate` / `locate_code` |
| 分析当前页面/弹窗的代码、状态、数据流与业务逻辑 | `/android-layout:analyze-screen` / `analyze-screen-logic` skill |
| 看懂当前页面（前台 App、Activity、可见入口） | `/android-layout:screen` / `get_state` + `dump_ui` |
| 检查某个可见控件的 bounds、center、可点击/enabled 状态与 class | `inspect-current-screen` skill / `find_elements` + `hit_test` |
| 真机验证 UI 改动（diff + 规则 + 截图） | `/android-layout:verify` / `diff_ui` + `analyze_ui` |
| 查找元素 / 命中测试 / 点击、滑动、输入 | `find_elements` / `hit_test` / `tap`、`swipe`、`input_text`、`press_key` |
| 截图（SVG 节点标注、图片坐标→设备坐标） | `screenshot` / `android-layout shot` |
| 在浏览器中可视化当前页面（仅显式请求） | `open_viewer` / `android-layout view` / `/android-layout:view` |
| 布局与无障碍问题检查 | `analyze_ui` / `android-layout analyze` |
| 改码前后布局对比 | `diff_ui` / `android-layout diff` |

## 数据来源速览

| 数据源 | 要求 | 适用场景 |
|---|---|---|
| `view` | 可调试 App | 完整 View 类名、resource id、layout params、可见性 |
| `semantics` | 无 | 任意 App 上的 Compose 文本、content description、可点击边界 |
| `compose` | 可调试 App + 本地 Android Studio + Java 17+ | Composable 名称、`file:line`、边界、参数、重组次数 |

`auto`（默认）会抓取 `view` + `semantics` 并按页面选择：XML 用 `view`，Compose 用 `semantics`，混合页面两者并用。需要 Composable 级别的细节时再显式使用 `--source compose`（约 8–12s）。详见 [docs/data-sources.zh.md](docs/data-sources.zh.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/data-sources.zh.md](docs/data-sources.zh.md) | 三个数据源原理与对照、`auto` 选择策略、Compose JVMTI 细节 |
| [docs/cli.zh.md](docs/cli.zh.md) | CLI 安装、命令一览、限制与默认值、分析规则、截图与坐标映射、环境变量 |
| [docs/mcp.zh.md](docs/mcp.zh.md) | MCP Server 配置、工具表、限制与默认值、推荐调用顺序 |
| [docs/cross-agent.zh.md](docs/cross-agent.zh.md) | 在其他 agent 中使用：配置外壳、实测客户端、技能安装、兼容测试 |
| [docs/plugin.zh.md](docs/plugin.zh.md) | Claude Code 插件组件、安装、典型流程、发布与版本号 |
| [docs/development.zh.md](docs/development.zh.md) | 开发、测试与实现说明 |

## 限制

- `view` / `compose` 要求 App `android:debuggable=true`；release 包只能用 `semantics`。
- JDWP 同一时间通常只允许一个调试客户端；Android Studio 正在调试时可能无法 attach。
- `compose` 额外需要本机 Android Studio 与 Java 17+，单次抓取约 8–12s。
- `input text` 只可靠支持 ASCII；每次命令都是全新快照，没有实时监听。
- 文本输出默认截断到 2000 节点（`--max-nodes`/`--depth`/`--visible-only` 只影响文本树）；`--json`/`--out` 写出完整 dump，MCP `dump_ui` 的 JSON 默认上限 800 节点，可调高 `maxNodes`。
- HTML 查看器最多嵌入 8 MB；超限会先丢弃 View 属性，再把节点预算折半至 200，并标记 `truncated`。
- `find`/`hit`/`tap` 的选择器只匹配可见节点；截图坐标点击需要截图元数据（`--image-*` 或 `imageX/Y/Width/Height`）。MCP `screenshot` 默认 720px 宽，CLI `shot` 保持原生分辨率。
- 直接画到 `Canvas` 上的内容（自定义 View、`SurfaceView`、`WebView` 像素）没有文本和子节点；语义树只能看到 App 暴露给无障碍的信息。
- 激活面向 Android 工程；在其他仓库中需要用户明确要求查看设备页面/界面，或明确提到 Android。

各数据源的完整边界见 [docs/data-sources.zh.md](docs/data-sources.zh.md)。

## 开发

```bash
npm test          # 基于 fixture 的单元测试，无需真机
npm run typecheck
npm run build     # 重新生成 dist/（需随源码一起提交）
```

详见 [docs/development.zh.md](docs/development.zh.md)。

## 致谢 / Attribution

- 协议与命中测试算法参考 [CoXier/LayoutInspectorV2-Pro](https://github.com/CoXier/LayoutInspectorV2-Pro)（Apache-2.0）。
- ViewDebug / DDM 协议来自 AOSP `android.view.ViewDebug`、`DdmHandleViewDebug` 与 ddmlib。
- Compose 树复用本机 Android Studio 的 transport/JVMTI agent 与 `androidx.compose.ui:ui-inspection`，协议来自 AOSP `tools/base` 的 `transport` / `app-inspection` / `dynamic-layout-inspector` 和 AndroidX `compose/ui/ui-inspection`（均为 Apache-2.0）。本项目不重新分发这些二进制，运行时从用户已安装的 Android Studio 读取。
- 本项目代码为独立实现，以 MIT License 发布；详见 `NOTICE`。
