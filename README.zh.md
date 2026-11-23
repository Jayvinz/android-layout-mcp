# layout-inspector-android

[English](README.md) | [简体中文](README.zh.md)

[![npm version](https://img.shields.io/npm/v/layout-inspector-android.svg)](https://www.npmjs.com/package/layout-inspector-android)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)
[![Node.js ≥ 20](https://img.shields.io/badge/node-%E2%89%A520-green.svg)](https://nodejs.org/)
[![CI](https://github.com/Jayvinz/layout-inspector-android/actions/workflows/validate.yml/badge.svg)](https://github.com/Jayvinz/layout-inspector-android/actions/workflows/validate.yml)

**面向 coding agent 的 Android 布局检查工具。** 通过 ADB 读取真实设备/模拟器上的实时界面，支持搜索、命中测试、带节点标注的截图、布局/无障碍检查、改码前后布局对比，并能把任意控件追溯到其 Compose/XML 源码与业务逻辑。

参考 [LayoutInspectorV2-Pro](https://plugins.jetbrains.com/plugin/21047-layoutinspectorv2-pro)。

## 核心特性

- **数据源自适应** —— `auto` 按页面选择正确的数据树：XML 用 ViewDebug v2，Compose 用无障碍语义树，混合页面两者并用；需要 Composable 名称与 `file:line` 时可显式启用 Compose JVMTI 树。
- **查找、命中测试、交互** —— 按文本 / content-description / resource-id / class / ref 搜索，解析某个坐标下的所有元素（按面积从小到大排序），然后点击、滑动或输入。
- **可视化验证** —— 截图支持 SVG 节点标注与图片坐标→设备坐标的自动映射；结构化抓取失败时会自动保存一张兜底截图。
- **检查与对比** —— 10 条布局/无障碍规则，以及围绕代码改动的 identity-keyed 改前/改后 diff。
- **UI → 源码定位** —— 以 UI 锚点扫描仓库，返回排序后的 `file:line` 候选、string/layout/Compose 定义与点击处理逻辑。全程只读，不修改仓库。
- **一个内核，两个前端** —— CLI 与 MCP server 共享同一套 `capture()` / `treesFor()` 流程，行为不会分叉。

## 架构

```
CLI (layout-inspector) ──┐
                         ├── core ──┬── JDWP + DDM → ViewDebug v2 视图树
MCP Server ──────────────┘          ├── adb uiautomator → Semantics 树
                                    └── Android Studio transport + JVMTI → Compose 树
```

## 快速上手

### 前置条件

- Node.js ≥ 20（插件 / MCP / CLI 均需要）
- Android platform-tools：`adb` 在 PATH 中，或设置 `DLI_ADB` / `ADB_PATH`
- 已开启 USB 调试的设备或模拟器，目标 App 运行在前台
- `view` / `compose` 数据源要求 App 为可调试构建（`android:debuggable=true`）；`semantics` 无此要求
- 使用 Claude Code 插件时，Claude Code 需能从 PATH 调用 `node` / `npm`

### 1. 接入 Claude Code 插件（推荐）

```text
/plugin marketplace add Jayvinz/layout-inspector-android
/plugin install layout-inspector-android@jayvinz-tools
```

安装成功后即获得：

| 组件 | 内容 |
|---|---|
| MCP server `layout-inspector-android` | `dump_ui`、`find_elements`、`locate_code`、`hit_test`、`analyze_ui`、`screenshot`、`diff_ui`、`tap` 等工具 |
| Slash 命令 | `/layout-inspector-android:locate`（UI→源码）、`:screen`（当前页面速览）、`:analyze-screen`（页面/弹窗逻辑）、`:verify`（真机验证改动） |
| Skills | `inspect-current-screen`、`locate-ui-code`、`analyze-screen-logic`、`verify-ui-change` |
| 只读子代理 | `ui-code-locator` |

可用 `/mcp` 确认 server 已加载，`/help` 中能看到上述命令。

**本地开发/调试**：先在仓库根目录执行 `npm install && npm run build`，再把 marketplace 指向本地路径：

```text
/plugin marketplace add E:/repo/layout-inspector-android
/plugin install layout-inspector-android@jayvinz-tools
```

组件清单、发布、版本号等细节见 [docs/plugin.zh.md](docs/plugin.zh.md)。

### 2. 接入 MCP Server（其他客户端）

```bash
node dist/cli.js mcp --print-config
```

把打印出的配置放进客户端的 MCP 配置文件（例如 Claude Code 项目根目录的 `.mcp.json`）：

```json
{
  "mcpServers": {
    "layout-inspector-android": {
      "command": "node",
      "args": ["E:/repo/layout-inspector-android/dist/mcp.js"]
    }
  }
}
```

工具清单、参数与推荐调用顺序见 [docs/mcp.zh.md](docs/mcp.zh.md)。

### 3. 作为 CLI 使用

```bash
npm install && npm run build
npm link                       # 提供全局 layout-inspector 命令

layout-inspector devices       # 已连接设备
layout-inspector state         # 屏幕、前台 App、pid
layout-inspector dump          # 抓取当前 UI（默认 auto）
layout-inspector find "开拍"   # 按文本查找
```

完整命令表、分析规则、截图与坐标映射见 [docs/cli.zh.md](docs/cli.zh.md)。

### 跑通第一个任务

把目标 App 摆到想要的页面，在 Claude Code 里直接说：

> 定位当前页面中的 **个人页** 按钮，以及其相关代码逻辑。

或运行命令：

```text
/layout-inspector-android:locate 个人页
```

工具会依次：确认前台 App → 抓取 UI 树 → 锁定目标节点 → 扫描仓库得到 `file:line` 候选 → 阅读代码输出定位报告。UI 改动完成后用 `/layout-inspector-android:verify` 做改前/改后对比验证。

如果要分析的是整个页面、弹窗或底部弹层而不是单个控件，可以说“分析当前界面的代码和业务逻辑”，或运行 `/layout-inspector-android:analyze-screen`：它会把页面各区块映射到源码，再追 ViewModel、数据来源、导航与副作用。

**仅支持 Android 工程。** 激活前会确认当前目录（或用户指定的仓库根目录）是 Android 工程（`settings.gradle(.kts)`、`gradlew`、应用 `com.android.*` 的模块 `build.gradle(.kts)`，或 `AndroidManifest.xml`）。在非 Android 仓库中，只有用户明确要求查看设备页面/界面或明确提到 Android 时才会激活；连接了设备并不代表仓库是 Android 工程。`PreToolUse` hook 会对 `get_state`、`dump_ui`、`find_elements`、`locate_code` 强制执行同一门槛。Hook 在会话启动时加载，安装或更新插件后需要重启 Claude Code。

## 能做什么

| 想做的事 | 入口 |
|---|---|
| 定位控件对应的 Compose/XML 源码与业务链路 | `/layout-inspector-android:locate` / `locate_code` |
| 分析当前页面/弹窗的代码、状态、数据流与业务逻辑 | `/layout-inspector-android:analyze-screen` / `analyze-screen-logic` skill |
| 看懂当前页面（前台 App、Activity、可见入口） | `/layout-inspector-android:screen` / `get_state` + `dump_ui` |
| 检查某个可见控件的 bounds、center、可点击/enabled 状态与 class | `inspect-current-screen` skill / `find_elements` + `hit_test` |
| 真机验证 UI 改动（diff + 规则 + 截图） | `/layout-inspector-android:verify` / `diff_ui` + `analyze_ui` |
| 查找元素 / 命中测试 / 点击、滑动、输入 | `find_elements` / `hit_test` / `tap`、`swipe`、`input_text` |
| 截图（SVG 节点标注、图片坐标→设备坐标） | `screenshot` / `layout-inspector shot` |
| 布局与无障碍问题检查 | `analyze_ui` / `layout-inspector analyze` |
| 改码前后布局对比 | `diff_ui` / `layout-inspector diff` |

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
| [docs/cli.zh.md](docs/cli.zh.md) | CLI 安装、命令一览、分析规则、截图与坐标映射、环境变量 |
| [docs/mcp.zh.md](docs/mcp.zh.md) | MCP Server 配置、工具表、推荐调用顺序 |
| [docs/plugin.zh.md](docs/plugin.zh.md) | Claude Code 插件组件、安装、典型流程、发布与版本号 |
| [docs/development.zh.md](docs/development.zh.md) | 开发、测试与实现说明 |

## 限制

- `view` / `compose` 要求 App `android:debuggable=true`；release 包只能用 `semantics`。
- JDWP 同一时间通常只允许一个调试客户端；Android Studio 正在调试时可能无法 attach。
- `compose` 额外需要本机 Android Studio 与 Java 17+，单次抓取约 8–12s。
- `input text` 只可靠支持 ASCII；每次命令都是全新快照，没有实时监听。
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
