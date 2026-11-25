# Android Layout MCP

[English](README.md) | [简体中文](README.zh.md)

![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)
![Node.js ≥ 20](https://img.shields.io/badge/node-%E2%89%A520-green.svg)
![CI](https://github.com/Jayvinz/android-layout-mcp/actions/workflows/validate.yml/badge.svg)

**一个 MCP 服务 + 编码 Agent 插件，让 Agent 看见真机上的 Android 界面，并找到界面背后的代码。**

编码 Agent 读仓库很强，但看不见手机。这个项目补上这一环：通过 ADB 抓取当前屏幕，把四种 Android 数据源归一成同一棵带短 ref 的节点树，然后回答：

- 当前界面有什么？→ `dump_ui`
- 这个元素在哪、能不能点？→ `find_elements` / `hit_test`
- 布局有没有问题？→ `analyze_ui`（12 条规则）
- 这块 UI 由哪个 Compose / XML 文件渲染，业务逻辑在哪？→ `locate_code` + 内置技能

## 亮点

| 亮点 | 对使用者意味着什么 |
|---|---|
| **四种数据源，一棵树** | View 层级（JDWP）、无障碍语义树（uiautomator）、`dumpsys activity`、Compose 检查器（JVMTI）输出同一种 `UiNode`，换屏幕类型不用换工作流。 |
| **`auto` 零配置** | 按屏幕自动选源：XML 用 View，Compose 用语义树，混合屏幕两棵都抓。日常使用不用记参数。 |
| **Release 包也能读** | `dumpsys` 不需要 debuggable，就能拿到真实 View 类、资源 id 和 Fragment 结构；文本按实测几何偏差合并，不写死状态栏高度。 |
| **UI → 源码，不用索引** | `locate_code` 以文本、id、类名、Composable 为锚点扫描仓库，返回打分排序的 `file:line` 候选。不需要 Gradle sync、语言服务器或构建。 |
| **在你已有的工具里可用** | 9 个 MCP 工具 + 编码 Agent 插件（5 个技能、5 个命令、门禁 Hook）+ 20 个 MCP 客户端的现成配置。 |
| **无原生依赖** | 纯 JavaScript，Node ≥ 20。截图在 JS 内缩放；除可选的 Compose helper 外无需编译。 |

## 环境要求

- Node.js ≥ 20（MCP 服务跑在 Node 上）
- `adb` 在 `PATH` 中（或设置 `ALM_ADB` / `ADB_PATH`），设备或模拟器已开启 USB 调试
- `view` / `compose` 源需要 debuggable 包；`semantics` / `dumpsys` 对任意 App 可用
- 只有 `compose` 源需要本地 Android Studio + Java（每次抓取约 8–12 秒）

## 安装与接入

### 编码 Agent 插件（推荐）

在 Claude Code 中：

```text
/plugin marketplace add Jayvinz/android-layout-mcp
/plugin install android-layout@jayvinz-tools
```

插件会自动拉起 MCP 服务，并带来技能、命令和门禁 Hook。安装后 `/mcp` 应能看到 `android-layout`，`/help` 应列出 `/android-layout:*` 命令。**重启一次 Claude Code**，Hook 才会加载。

离线或本地方式：

```bash
# 发布包（自包含，已带 production node_modules）
claude --plugin-dir ./android-layout-mcp-<version>.zip

# 本地仓库（先构建；从本地路径添加的市场不会替你装依赖）
npm install && npm run build
claude --plugin-dir E:/repo/android-layout-mcp
```

### 其他 MCP 客户端

服务本身是标准 stdio MCP，任何客户端都能拉起。克隆仓库、构建一次，然后让客户端指向 `dist/mcp.js`：

```json
{
  "mcpServers": {
    "android-layout": {
      "command": "node",
      "args": ["<你的克隆路径>/dist/mcp.js"]
    }
  }
}
```

需要固定设备或工具链时，往 `args` 里加 `--serial`、`--adb`、`--timeout`，或 Compose 相关参数（`--studio`、`--java`、`--compose-version`）。VS Code、Codex、Zed、Goose、OpenCode、Amp 等客户端的外壳不同，[docs/mcp.zh.md](docs/mcp.zh.md) 列出了全部 20 个 id 和各自的写法。

想把 5 个技能也带过去，复制到你使用 Agent 的技能目录：

```bash
node scripts/sync-agent-skills.mjs --dest <你的-Android-项目>
# --codebuddy、--workbuddy、--both、--global、--check、--dry-run
```

Cursor 和 VS Code 直接读 `.claude/skills/`，无需复制。斜杠命令和强门禁只在 Claude Code 中存在，其他客户端靠每个技能正文里的软规则。

命名：仓库和 npm 包是 `android-layout-mcp`；MCP 服务名和插件名是 `android-layout`。npm 包没有发布到 registry：装插件或加载发布 zip。

## 第一次运行

```text
/mcp                        # 确认 android-layout 服务已加载
/android-layout:capture     # 抓取当前屏幕
```

或者直接问：“当前界面有什么？” 一次 `dump_ui(source="auto", format="tree")` 的返回大致是：

```
device <serial> (Pixel 7)  android 13 (sdk 33)
screen 1080x2400 @ 440dpi (2.75x) portrait
target com.example.app.debug pid=9597 activity=...MainActivity debuggable
primary source: view (captured: view, semantics)
ui kind: xml
view window: .../android.view.ViewRootImpl@60b9a5d (100ms)
semantics rotation=0 (900ms)

v0 DecorView [0,0][1080,2400] 1080x2400 @(540,1200)
  v1 FrameLayout [0,0][1080,2400] 1080x2400 @(540,1200)
    v2 FrameLayout id/content [0,0][1080,2400] 1080x2400 @(540,1200)
```

然后把 App 停在目标页面，直接说：

> 定位当前屏幕上的 **Me** 按钮，并追踪到相关代码逻辑。

或运行 `/android-layout:trace-view Me`。Agent 会确认前台 App、抓取节点树、锁定目标节点、扫描 `file:line` 候选，再打开代码阅读。要追一整个区块，说“这块区域的业务逻辑”或“从这块 UI 追到业务代码”：区块就是切入点，Agent 会沿 UI → 状态 → 数据回溯到产生它的业务代码与逻辑，每一跳给出 `file:line`。

## 上层组件用法

技能、命令、MCP 工具都是同一个 core 之上的层。

### MCP 工具（9 个）

| 工具 | 回答什么 | 主要参数 |
|---|---|---|
| `list_devices` | 连了哪些设备？ | — |
| `get_state` | 屏幕、前台 App、pid、ViewRootImpl 窗口 | `serial`、`package` |
| `dump_ui` | 整棵树是什么样？ | `source`、`format=json\|tree`、`depth`、`maxNodes`、`includeProperties`、`visibleOnly`、`window`、`savePath` |
| `find_elements` | 这段文本 / id / 类名 / ref 在哪？ | `query`、`by`、`match`、`clickable`、`both`、`includeInvisible`、`limit` |
| `hit_test` | (x, y) 上是什么？ | `x`、`y`、`index`、`source` |
| `locate_code` | 哪个源文件渲染了这个元素？ | `text[]`、`desc[]`、`id[]`、`className[]`、`composeName`、`composeFile` + `composeLine`、`root`、`limit`、`includeTests`、`exclude[]` |
| `analyze_ui` | 布局有没有问题？ | `rules[]`、`minTouchTargetDp`（48）、`maxDepth`（14）、`includeProperties` |
| `screenshot` | 画面长什么样？ | `maxWidth`（720）、`scale`、`fullResolution`、`savePath`、`annotate` |
| `list_fragments` | Activity / Fragment 结构 | `package`、`includeFramework` |

推荐调用顺序：`get_state` → `dump_ui(source="auto", format="tree")` → `find_elements` 或 `hit_test` → 按需 `screenshot` / `analyze_ui`。只有用户要看源码时才调用 `locate_code`。完整参考：[docs/mcp.zh.md](docs/mcp.zh.md)。

### 技能（Claude Code 及其他 Agent）

5 个技能按两个维度切分——粒度与意图——每个格子只有一个归属：

| | 事实 | 属性值 | 源码 | 缺陷 |
|---|---|---|---|---|
| **单个元素** | `capture-ui`（定位部分） | `inspect-view-attribute` | `trace-view-wiring` | — |
| **一个区块** | — | — | `trace-ui-logic` | — |
| **整个屏幕** | `capture-ui` | — | — | `audit-ui` |

| 技能 | 交给它什么 | 典型说法 |
|---|---|---|
| `capture-ui` | 结构、Activity、`uiKind`、可点击入口、坐标、保存的产物 | "当前界面有什么"、"抓取当前页面布局" |
| `inspect-view-attribute` | 单个 View 的 margin、padding、测量尺寸、文字度量、背景、RTL | "这个按钮的边距是多少" |
| `trace-view-wiring` | 单个元素的实现类、点击处理、显隐规则、内容注入 | "这个按钮在哪实现的" |
| `trace-ui-logic` | 一个 UI 区块背后的业务代码与逻辑 —— 区块是切入点，答案是带 `file:line` 的 UI → 状态 → 数据（只读） | "这块区域的业务逻辑"、"从这块 UI 追到业务代码" |
| `audit-ui` | 缺陷判定，并逐条对应到造成问题的 XML / Composable | "有没有重叠"、"布局有没有问题" |

### 斜杠命令（Claude Code）

| 命令 | 参数 |
|---|---|
| `/android-layout:capture` | 可选：区块或包名 |
| `/android-layout:inspect-view` | 元素文本 / id / ref |
| `/android-layout:trace-view` | 元素文本 / id / ref |
| `/android-layout:trace-logic` | 作为切入点的 UI 区块 |
| `/android-layout:ui2logic` | `trace-logic` 的别名 |
| `/android-layout:audit` | 可选：区块 |

命令只是入口：绑定 `$ARGUMENTS`、点名对应技能、带一行门禁指引。规则只写在技能里，不在两处重复。

### 门禁 Hook

9 个会碰设备的工具都受 Android 项目门禁约束。插件里的 `PreToolUse` Hook 在非 Android 工作区会直接拒绝，除非用户最新一句话明确要求看设备屏幕或提到 Android。`locate_code` 更严：必须有 Android 项目或明确提到 Android。判定依据是 `settings.gradle(.kts)`、`gradlew(.bat)`、应用 `com.android.*` 的模块，或 `AndroidManifest.xml`。连着设备不代表仓库是 Android 项目。设置 `ALM_GATE_DEBUG=1` 可记录判定过程。

### 脚本

```bash
# 从 UI 锚点给源码候选排序，无需 npm install
node scripts/locate-code.mjs --root . --text "登录" --id "login_btn" --compose-name "LoginScreen" --json

# 把 5 个技能复制到其他 Agent 的技能目录
node scripts/sync-agent-skills.mjs --dest ../my-android-app --both
```

`locate-code.mjs` 只给候选排序，务必打开文件确认；它不会修改仓库。

## 屏幕是怎么读出来的

| 数据源 | 前提 | 能拿到 | 耗时 |
|---|---|---|---|
| `view`（JDWP） | debuggable 包 | 真实 View 类、资源 id、文本、padding/margin、layout params、可见性 | ~100 ms |
| `semantics`（uiautomator） | 无 | 文本、contentDescription、可点击边界；类名是无障碍角色而非真实类 | ~0.5–3 s |
| `dumpsys`（ActivityManager） | 无 | 真实 View 类、资源 id、窗口边界、Activity/Fragment 记录；文本从语义树合并 | ~100–300 ms |
| `compose`（JVMTI） | debuggable 包 + Android Studio + Java | Composable 名称、`file:line`、边界、参数、重组次数 | ~8–12 s |

Compose 屏幕上 `view` 源到 `AndroidComposeView` 就停了——这正是 `auto` 改用语义树、以及需要 Composable 级答案时用 `source=compose` 的原因。各源的实测对比：[docs/data-sources.zh.md](docs/data-sources.zh.md)。

## 需要知道的事

- **ref 只在一次抓取内有效。** `v*`（view）、`s*`（semantics）、`d*`（dumpsys）、`c*`（compose）只对产生它的那次抓取成立。做前后对比时，按来源、资源 id、类名、文本和路径匹配。
- **产物留在本地。** 抓取流程会写 `.alm/capture.json`、`.alm/capture.png`、`.alm/capture.xml`。把 `.alm/` 加进 `.gitignore`；dump 里可能有设备序列号、包名和屏幕文本。Android Studio 的 Layout Inspector 打不开这些文件（`.li` 是私有格式）。
- **图片坐标 ≠ 设备坐标。** 缩放后的截图会返回 `coordinateMapping.imageToDevice`，做命中测试或对外报坐标前先换算；`find_elements` / `hit_test` 返回的已经是设备坐标。
- **截图是兜底，不是事实来源。** 结构化抓取失败时，会存一张缩放后的 `alm-fallback-<time>.png` 并作为图片内容返回。可用 `ALM_NO_FALLBACK_SCREENSHOT=1` 关闭。
- **常用环境变量：** `ALM_ADB` / `ADB_PATH`、`ANDROID_SERIAL`、`ALM_ANDROID_STUDIO`、`ALM_JAVA`、`ALM_COMPOSE_VERSION`、`ALM_NO_FALLBACK_SCREENSHOT`。完整表格：[docs/cli.zh.md](docs/cli.zh.md#环境变量)。
- **JDWP 同时只允许一个调试器。** Android Studio 正在调同一个 App 时，attach 可能失败。
- **Canvas 画出来的像素没有节点。** 自定义 `Canvas` 绘制、`SurfaceView`、`WebView` 内容没有子节点或文本；语义树只能看到 App 主动暴露给无障碍的内容。
- **上限：** `dump_ui` 的 JSON 默认上限 800 个节点、文本树 1500 个节点，可用 `maxNodes` 提高；`savePath` 会写完整未裁剪的 dump。`compose` 源需要 Android Studio + Java 17+，每次约 8–12 秒。
- **参与开发：** `dist/` 是刻意提交的（市场安装后直接运行，不做构建），`package.json` 是唯一版本来源。改完 `src/` 要跑 `npm run build` 并在同一次提交里带上 `dist/`。详见 [AGENTS.md](AGENTS.md) 和 [docs/development.zh.md](docs/development.zh.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/plugin.zh.md](docs/plugin.zh.md) | 编码 Agent 插件：安装方式、发布包、发版 |
| [docs/mcp.zh.md](docs/mcp.zh.md) | 工具参考、客户端配置、默认值、上限、调用顺序 |
| [docs/cli.zh.md](docs/cli.zh.md) | 分析规则、环境变量、共享参数 |
| [docs/data-sources.zh.md](docs/data-sources.zh.md) | 每种树怎么读、读到哪停 |
| [docs/cross-agent.zh.md](docs/cross-agent.zh.md) | 20 个客户端、技能可移植性、已实测客户端 |
| [docs/development.zh.md](docs/development.zh.md) | 开发、测试、打包约束 |
| [blog/](blog/) | 两篇走读：快速上手，以及抓取原理 |

对应英文版是 `docs/*.md`。

## 许可

MIT，见 [LICENSE](LICENSE)。TypeScript 代码为独立实现；协议与命中测试行为参考 [CoXier/LayoutInspectorV2-Pro](https://github.com/CoXier/LayoutInspectorV2-Pro)（Apache-2.0）和 AOSP 的 `android.view.ViewDebug` / `DdmHandleViewDebug` / ddmlib；Compose 树在运行时读取本地 Android Studio 的 transport、JVMTI agent 和 `androidx.compose.ui:ui-inspection`。[NOTICE](NOTICE) 记录完整来源。