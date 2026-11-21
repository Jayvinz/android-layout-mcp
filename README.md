# layout-inspector-android (layout-inspector)

参考 [LayoutInspectorV2-Pro](https://plugins.jetbrains.com/plugin/21047-layoutinspectorv2-pro) 的 Android 布局检查工具，
提供命令行 CLI 和 MCP Server，让 coding agent 可以直接读取、搜索、命中测试、截图、分析真实设备上的 UI，
并在改代码后对比布局变化。

`view` / `semantics` 两路完全不依赖 Android Studio；可选的 **Compose JVMTI 树**会复用本机已安装的
Android Studio 中的 transport daemon、JVMTI agent 和 inspector 协议，得到与 Android Studio Layout
Inspector 同级的 Compose 树（Composable 名称、文件/行号、bounds、参数/文本、重组计数）。

```
CLI (layout-inspector) ──┐
                         ├── core ──┬── JDWP + DDM → ViewDebug v2 视图树（View 属性、padding、margin、visibility…）
MCP Server ──────────────┘          ├── adb uiautomator → Semantics 树（Compose 文本、content-desc、clickable…）
                                    └── Android Studio transport/JVMTI → Compose 树（Composable、文件/行号、bounds、参数、重组计数）
```

## English overview

`layout-inspector` is a CLI and MCP server for inspecting a live Android screen over ADB. It reads the ViewDebug hierarchy over JDWP, the accessibility/semantics tree via `uiautomator`, and optionally the Jetpack Compose JVMTI tree through a locally installed Android Studio. Coding agents use it to dump and search UI, hit-test or tap coordinates, take screenshots, check layout issues, diff before/after layouts, and trace a visible element back to Compose/XML source.

### Data sources

| Source | How it works | Requires | Best for |
|---|---|---|---|
| `view` | JDWP + ViewDebug v2 | A debuggable app | Full View classes, resource ids, padding/margins, visibility, layout params |
| `semantics` | `adb shell uiautomator dump` | Nothing | Compose text, content descriptions, clickable bounds on any app |
| `compose` | Android Studio transport + JVMTI | Debuggable app + Android Studio + Java 17+ | Composable names, `file:line`, bounds, parameters, recomposition counts |

`--source auto` (the default) captures `view` + `semantics` and selects `view` for XML screens, `semantics` for Compose screens, and both for mixed screens. `--source compose` is opt-in because it takes roughly 8–12 seconds and has extra dependencies. `--source both` explicitly captures and searches both view and semantics trees.

### Install

Requirements: Node.js ≥ 20 and Android platform-tools (`adb` on `PATH`, or set `DLI_ADB`/`ADB_PATH`).

```bash
npm install
npm run build

node dist/cli.js devices     # run directly
npm link                     # or install the `layout-inspector` command globally
layout-inspector devices
```

For development without building: `npx tsx src/cli.ts dump`.

### CLI quick start

```bash
layout-inspector devices                 # connected devices
layout-inspector state                   # screen, foreground app, pid, windows
layout-inspector dump                    # current UI (auto source)
layout-inspector dump --source view --depth 8 --props
layout-inspector dump --source both --json --out ui.json

layout-inspector find "开拍" --both
layout-inspector find "com.example:id/submit" --by id
layout-inspector hit 540 2239 --both     # smallest-area hit test
layout-inspector inspect v4              # full node details

layout-inspector shot --out screenshot.png --annotate
layout-inspector analyze                 # layout/accessibility rules
layout-inspector tap --text "关注"
layout-inspector swipe 540 1800 540 600

layout-inspector dump --json --out before.json
layout-inspector dump --json --out after.json
layout-inspector diff before.json after.json
```

Global options: `-s/--serial`, `--adb <path>`, `--timeout <ms>`, `-v/--verbose`. Compose options: `--studio <path>`, `--java <path>`, `--compose-version <v>`.

### MCP server

Start the built server with `node dist/mcp.js`, or print a client config with `node dist/cli.js mcp --print-config`. Example `.mcp.json`:

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

Tools: `list_devices`, `get_state`, `dump_ui`, `find_elements`, `locate_code`, `hit_test`, `analyze_ui`, `screenshot`, `diff_ui`, `tap`, `swipe`, `input_text`, `press_key`.

Recommended agent flow: `get_state` → `dump_ui` or `find_elements` → `tap` → `screenshot` → `analyze_ui`; after a code change, `dump_ui(savePath=before.json)` → change → `dump_ui(savePath=after.json)` → `diff_ui`.

### Claude Code plugin

The repository is also a Claude Code marketplace (`jayvinz-tools`) and plugin (`layout-inspector-android`):

```text
/plugin marketplace add Jayvinz/layout-inspector-android
/plugin install layout-inspector-android@jayvinz-tools
```

This adds the MCP server plus the `locate-ui-code` and `verify-ui-change` skills, the `/layout-inspector-android:locate`, `:screen`, and `:verify` commands, and the read-only `ui-code-locator` agent.

### Environment variables

| Variable | Purpose |
|---|---|
| `DLI_ADB` / `ADB_PATH` / `--adb` | Path to `adb` |
| `ANDROID_SERIAL` / `--serial` | Target device when several are connected |
| `DLI_ANDROID_STUDIO` / `--studio` | Android Studio installation for Compose inspection |
| `DLI_JAVA` / `--java` | Java used by the Compose helper |
| `DLI_COMPOSE_VERSION` | App's Compose version (default `1.8.3`) |
| `DLI_COMPOSE_INSPECTOR_JAR` | Explicit Compose `inspector.jar` |
| `DLI_COMPOSE_HELPER_JAR` | Precompiled JVMTI helper JAR |
| `DLI_NO_FALLBACK_SCREENSHOT=1` | Disable the fallback screenshot on capture failure |

### Development

```bash
npm test          # fixture-based unit tests, no device required
npm run typecheck
npm run build     # regenerates dist/ (committed)
npm run build:helper   # rebuild the Compose JVMTI helper against local Android Studio
```

### Limitations

- `view` requires `android:debuggable=true`.
- JDWP usually allows one debugger at a time; detach Android Studio if attach fails.
- `compose` additionally requires local Android Studio, Java 17+, a foreground app, and a matching Compose inspector version.
- `input text` reliably supports ASCII only.
- Each command captures a fresh snapshot; there is no live monitoring.

The Chinese sections below contain the complete command/tool reference, protocol details, analysis rules, and edge cases.

## 为什么需要三个数据源

| | `view`（JDWP） | `semantics`（uiautomator） | `compose`（JVMTI） |
|---|---|---|---|
| 原理 | 与 LayoutInspectorV2-Pro 相同：JDWP + ViewDebug v2 | `uiautomator dump` 无障碍语义树 | 复用 Android Studio 的 transport daemon + JVMTI + Compose inspector |
| 依赖 | 可调试 App | 无 | 可调试 App + 本机 Android Studio + Java |
| Jetpack Compose 结构 | ❌ 停在 `AndroidComposeView` | ⚠️ 只有无障碍语义（类名/文本） | ✅ Composable 名称、文件/行号、bounds、参数、重组计数 |
| View 属性 | ✅ 完整 | ⚠️ 部分 | ❌ |
| Compose 文本 | ❌ | ✅ | ✅（从 Composable 参数提取） |
| 速度 | ~100ms | ~0.5–3s | ~8–12s（含 daemon/agent 启动） |

`--source auto`（默认）会按当前屏幕自动选择：

| 屏幕类型 | 自动选择 | find / hit / tap |
|---|---|---|
| 纯 XML | `view` | 只查 view |
| 纯 Compose | `semantics` | 只查 semantics |
| **XML + Compose 混合** | **view + semantics** | **自动同时查两棵树** |

分类来自 ViewDebug 树的启发式规则（`classifyUi`）：有 `ComposeView`/`AndroidComposeView`
且存在 XML 内容或 `AndroidViewsHandler` 内的 interop View → `mixed`；只有框架/Compose 包装
容器 → `compose`；没有 ComposeView → `xml`。抓取结果和 JSON 中会带 `uiKind: xml|compose|mixed|unknown`。

- 跨页面自动切换：XML 页面走 view、Compose 页面走 semantics，无需配置。
- 混合页面：`dump` 会自动打印 view + semantics 两棵树；
  `find`/`hit`/`tap --text` 在 auto 下会自动同时搜索 view + semantics。
- `--source both` 显式获取 view + semantics；`--source compose` 单独使用 JVMTI Compose 树。
- `hit`/MCP 的 `hit_test` 默认同时查询 view 和 semantics。

### 实测能力对照（Android 13 / API 33 真机）

传统 XML View App（`com.example.demo.free.debug`）：

```
v9 Button "Re-run checks" [38,953][540,1085] {click}
   DecorView > ActionBarOverlayLayout > FrameLayout id/content > LinearLayout > LinearLayout > Button
v11 ScrollView ... {scroll}
```

- **view 源**：20 个节点，类名精确（`android.widget.Button`、`ScrollView`、`Toolbar`），文本、
  resource-id、padding/margin、layout params、clickable、scroll 全部可用。API 33 上的 TextView
  文本属性名为 `text:text`（同时兼容旧版 `text:mText`）。
- **semantics 源**：约 18 个节点，文本可用，但类名退化为无障碍角色（`Button`/`ViewGroup`），
  且 `textAllCaps` 会变成 `RE-RUN CHECKS`。
- `auto` 对 XML 界面选择 **view**（信息更完整）。

Compose App（`com.example.droidreel.debug`）：

```
v3 ComposeView / v4 AndroidComposeView ...   ← view 源到这里就结束了，没有文本
s43 TextView "开拍" / s44 Button ...          ← semantics 源有真实文本和点击区域
```

- **view 源**：只有 10 个 View 节点，内容停在 `AndroidComposeView` / `AndroidViewsHandler`，
  **没有 Compose 文本和控件**。
- **semantics 源**：49 个节点，文本、content-description、clickable、bounds、scrollable、
  checkable、enabled 都可用；零配置下的 Compose 主数据源。
- **compose 源（JVMTI）**：489 个 Composable 节点，例如：

  ```
  c0 DroidReelTheme CommunityActivity.kt:85 [0,80][1080,2356] 1080x2276
    c10 Text CommunityActivity.kt:224 "DroidReel" [44,117][937,186] {has_merged_semantics}
    c60 Text CommunityActivity.kt:255 "推荐" [236,265][304,313]
  ```

  含 Composable 名称、`file:line`、bounds、参数文本、`SYSTEM_CREATED`/`INLINED` 等 flags、
  重组/跳过计数。适合回答“这个像素属于哪个 Composable / 哪一行代码”。
- `auto` 对 Compose 界面选择 **semantics**（零依赖）；显式 `--source compose` 才走 JVMTI。

### Studio / JDK 版本适配

- **Studio 版本**：不假设固定安装路径；会读取 `product-info.json` / `build.txt` 得到版本号，
  `layout-inspector studio` 会显示 build。不同版本的 protobuf/gRPC 类名和 inspector proto 可能不同，因此
  helper 不再只依赖预编译 jar：首次使用某个 Studio build 时，会用**该 Studio 自带的 JBR
  `javac`/`jar`** 针对其 `plugins/android/lib/*.jar` 重新编译 helper，并按
  `Studio build + helper 源码 hash + 编译器版本` 缓存到
  `~/.cache/layout-inspector-android/helper/<key>/`。
- **JDK 版本**：Java 选择顺序为 `--java` → `DLI_JAVA` → `JAVA_HOME` → Studio JBR → PATH。
  helper 编译优先使用**与运行时 Java 同一目录下的 `javac`/`jar`**，避免 class file version
  不匹配；没有编译器时回退到打包的 helper。实测：
  - Studio JBR 25 → helper class 69，可运行；
  - Microsoft OpenJDK 17（`--java` 指定）→ 自动用其 `javac` 编译 class 61，可运行。
- 若使用其他 JBR/JDK，可用：
  ```bash
  layout-inspector dump --source compose --java "C:/path/to/jdk/bin/java.exe"
  ```
  或显式提供已编译 helper：`DLI_COMPOSE_HELPER_JAR=/path/to/helper.jar`。
- 兼容边界：Studio 版本过旧、缺少 `layout_inspector_compose_java_proto.jar` 等工件，或
  Compose inspector proto 缺少所需消息时，helper 编译会失败并给出提示；此时请升级 Studio，
  或用 `npm run build:helper` 针对兼容的 Studio 构建，或回退到 `source=semantics`。
  当前实测版本：Android Studio `AI-262.10968.63.2622.16840690`（JBR 25）。

### Compose JVMTI 树（Android Studio 级）

```bash
layout-inspector dump --source compose --depth 10
layout-inspector find 推荐 --source compose
layout-inspector hit 540 2239 --source compose
layout-inspector analyze --source compose
layout-inspector dump --source compose --json --out ui.json
```

前置条件：

- App 是可调试构建（`android:debuggable=true`）；
- 本机安装 Android Studio（默认自动探测；可用 `DLI_ANDROID_STUDIO` 或 `--studio` 指定）；
  探测顺序：`--studio`/环境变量 → **正在运行的 `studio64.exe`/`studio` 进程路径** → 常见安装路径。
  优先使用开发者实际在用的那个 Studio 安装（同时覆盖自定义/Toolbox 安装）；可用 `layout-inspector studio`
  查看实际命中的路径和来源；
- Java 17+（优先用 Android Studio 自带 JBR；可用 `DLI_JAVA` 或 `--java` 指定）；
- Compose inspector jar 默认按 **1.8.3** 下载并缓存到 `~/.cache/layout-inspector-android/`；
  如 App 的 Compose 版本不同，设置 `DLI_COMPOSE_VERSION` 或 `DLI_COMPOSE_INSPECTOR_JAR`；
- 只支持 API 29+（Compose inspector 要求），并且 App 需在前台。

实现上复用了 Android Studio 自带的：

- `plugins/android/resources/transport/<abi>/transport`（设备端 gRPC transport daemon）
- `transport/native/agent/<abi>/libjvmtiagent.so`（JVMTI agent）
- `perfa.jar`、`layoutinspector-view-inspection.jar`
- Compose `ui-android` AAR 中的 `inspector.jar`
- 以及 Studio 的 `transport/app_inspection/view_layout_inspection/compose_layout_inspection` proto

CLI 会自动 push daemon/agent、`run-as` 安装 inspector jar、attach agent、通过 gRPC 驱动
View inspector（只拿 root view id，关闭截图以避免 78MB 的 SKP 内存峰值）和 Compose inspector。
daemon 会常驻在 `/data/local/tmp/dli-compose`，后续调用直接复用；用
`layout-inspector compose-clean` 停止 daemon 并清理设备侧文件。

Compose 源的边界：

- 能拿到：Composable 名称、包/文件名/行号、layout/render bounds、参数和文本、重组/跳过计数、
  merged/unmerged semantics 标记；
- 拿不到：Modifier 链的完整顺序、自定义 Layout 的测量过程、非参数化的内部状态；
- 文本来自 Composable 参数提取（`GetAllParameters`），不是每个节点都有；
- 速度明显慢于 view/semantics（8–12s），只在需要 Compose 结构/源码定位时使用。

`semantics` 仍然保留为**零配置、零依赖**的 Compose 方案；默认也拿不到 `testTag` 作为
resource-id，除非 App 在祖先节点开启 `testTagsAsResourceId` 语义：

```kotlin
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId

Box(modifier = Modifier.semantics { testTagsAsResourceId = true }) {
    Button(modifier = Modifier.testTag("submit"), onClick = {}) {
        Text("Submit")
    }
}
```

之后 `find --by id submit` 就能定位（旧版 Compose 可能需要
`@OptIn(ExperimentalComposeUiApi::class)`）。
对 locator 稳定性要求高时，优先加 `Modifier.semantics { contentDescription = "..." }`
或 `testTag`，不要依赖文本（文本会随语言/大小写变化）。

混合界面（XML + Compose）在 `auto` 下会自动抓取并展示 view + semantics，并让 `find`/`hit`/`tap`
同时搜索两棵树；MCP 也可以显式 `find_elements(both=true)`。


## 安装

要求：Node.js ≥ 20，Android platform-tools（`adb` 在 PATH 中，或设置 `DLI_ADB` / `ADB_PATH`）。

```bash
npm install
npm run build

# 方式一：直接调用
node dist/cli.js devices

# 方式二：链接成全局命令
npm link
layout-inspector devices
```

也可以不构建，直接开发模式运行：`npx tsx src/cli.ts dump`。

## CLI 快速上手

```bash
# 设备与前台 App
layout-inspector devices
layout-inspector state

# 当前界面（默认 auto，Compose 会走 semantics）
layout-inspector dump

# 指定数据源与深度；JSON 输出可直接交给 agent
layout-inspector dump --source view --depth 8 --props
layout-inspector dump --source both --json --out ui.json

# 按文本 / id / class / ref 查找
layout-inspector find "开拍" --both
layout-inspector find "com.example:id/submit" --by id
layout-inspector find "Button" --by class --match exact --clickable

# 屏幕坐标命中测试（最小面积优先，重叠时 --index 切换）
layout-inspector hit 540 2239 --both

# 截图（可降分辨率），附带节点框的 SVG 叠加层
layout-inspector shot --out screenshot.png --annotate
layout-inspector shot --out small.png --max-width 540
layout-inspector shot --out small.png --scale 0.5

# 布局 / 无障碍问题检查
layout-inspector analyze

# 点击元素中心（自动先定位再 tap）
layout-inspector tap --text "关注"
layout-inspector tap 540 2239

# 两次快照对比：改代码 / 切换页面前后
layout-inspector dump --json --out before.json
# ... 修改、重新运行、刷新页面 ...
layout-inspector dump --json --out after.json
layout-inspector diff before.json after.json

# 查看某个节点的全部属性
layout-inspector inspect v4
layout-inspector inspect 0.0.0
```

`dump` 的人类可读输出示例：

```
device <serial> (Pixel 7)  android 13 (sdk 33)
screen 1080x2400 @ 440dpi (2.75x) portrait
target com.example.droidreel.debug pid=9597 activity=...CommunityActivity debuggable
view window: com.example.droidreel.debug/.../android.view.ViewRootImpl@60b9a5d (100ms)

v0 DecorView [0,0][1080,2400] 1080x2400 @(540,1200)
  v1 FrameLayout [0,0][1080,2400] 1080x2400 @(540,1200)
    v2 FrameLayout id/content [0,0][1080,2400] 1080x2400 @(540,1200)
      v3 ComposeView [0,0][1080,2400] 1080x2400 @(540,1200)
```

## 命令一览

| 命令 | 说明 |
|---|---|
| `layout-inspector devices` | 列出设备、型号、Android/SDK 版本 |
| `layout-inspector state` | 设备、屏幕、前台 App、pid、ViewRootImpl 窗口 |
| `layout-inspector windows` | 仅列出 JDWP 窗口（弹窗/对话框也会出现） |
| `layout-inspector dump` | 抓取 UI，`--source auto/view/semantics/compose/both`、`--depth`、`--props`、`--json`、`--out` |
| `layout-inspector find <query>` | `--by any/text/desc/id/class/ref`、`--match contains/exact/regex`、`--clickable`、`--both` |
| `layout-inspector hit <x> <y>` | 命中测试；返回同一坐标下的所有候选，最小面积优先 |
| `layout-inspector inspect <ref>` | 输出单个节点的完整 JSON（含 View 属性） |
| `layout-inspector analyze` | 布局/无障碍检查，见下表 |
| `layout-inspector shot` | 截图；`--max-width` / `--scale` 降分辨率；`--annotate` 生成 `*.annotated.svg` |
| `layout-inspector diff <a> <b>` | 对比两个 dump JSON |
| `layout-inspector tap` | 设备坐标点击、`--image-*` 截图坐标映射点击，或 `--text/--id/--ref` 选择元素后点击其中心 |
| `layout-inspector swipe` / `input` / `key` | 滑动、输入 ASCII 文本、发送 keyevent |
| `layout-inspector studio` | 显示用于 Compose inspection 的 Android Studio 路径、来源（explicit/env/default/process）、JBR Java |
| `layout-inspector mcp` | 启动 MCP Server（stdio）；`--print-config` 打印客户端配置 |
| `layout-inspector compose-clean` | 停止常驻 transport daemon，清理 `/data/local/tmp/dli-compose` 和 App code_cache 中的 inspector jar |

全局选项：`-s, --serial`、`--adb <path>`、`--timeout <ms>`、`-v, --verbose`。
Compose JVMTI 相关：`--studio <path>`、`--java <path>`、`--compose-version <v>`。
截图兜底：抓取失败时自动保存一张 `dli-fallback-<时间>.png`（默认 720px 宽）；用
`--no-fallback-screenshot` 关闭。多设备时也可用 `ANDROID_SERIAL`。

## MCP Server

### 配置

构建后直接用 `node dist/mcp.js` 启动，或让 CLI 打印配置：

```bash
node dist/cli.js mcp --print-config
```

Claude Code（项目根目录 `.mcp.json`）：

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

或使用 CLI 命令：

```bash
claude mcp add layout-inspector-android -- node E:/repo/layout-inspector-android/dist/mcp.js
```

（示例按仓库名 `layout-inspector-android` 写路径；本地目录不同时用实际目录替换。）

MCP Server 也接受 Compose 相关参数：`--studio <path>`、`--java <path>`、`--compose-version <v>`。

多设备 / 自定义 adb：

```json
{
  "mcpServers": {
    "layout-inspector-android": {
      "command": "node",
      "args": [
        "E:/repo/layout-inspector-android/dist/mcp.js",
        "--serial", "<serial>",
        "--adb", "D:/Android/Sdk/platform-tools/adb.exe",
        "--timeout", "30000"
      ]
    }
  }
}
```

### 工具

| 工具 | 作用 |
|---|---|
| `list_devices` | 设备列表 |
| `get_state` | 屏幕、前台 App、pid、窗口 |
| `dump_ui` | 抓 UI；`source=auto/view/semantics/compose/both`、`format=json/tree`、`depth`、`maxNodes`、`savePath` |
| `find_elements` | 按文本/描述/id/类/ref 搜索；返回 bounds、tap 中心、clickable、完整路径 |
| `locate_code` | 根据 UI 锚点（text/desc/id/Compose file+line/class）扫描 Android 仓库，返回字符串/布局/Compose 定义和排序后的 `file:line` 候选 |
| `hit_test` | 坐标命中；默认同时返回 view 与 semantics；`source=compose` 可查 Compose 树 |
| `analyze_ui` | 布局/无障碍问题检查 |
| `screenshot` | 返回 PNG image content；默认降采样到 720px 宽（`fullResolution=true` 关闭），可保存并生成 SVG 叠加层 |
| `diff_ui` | 对比两个 `dump_ui(savePath)` 写出的 JSON |
| `tap` | 坐标或 `text/id/ref` 元素点击 |
| `swipe` / `input_text` / `press_key` | 交互 |

推荐给 coding agent 的调用顺序：

1. `get_state` → 确认前台 App；
2. `dump_ui(source="auto", format="tree")` 或 `find_elements` → 看界面 / 定位；
3. `tap` → 操作；
4. `screenshot` → 视觉确认；
5. `analyze_ui` → 检查小触摸区、重叠、裁剪等；
6. 修改代码后：`dump_ui(savePath=before.json)` … `dump_ui(savePath=after.json)` → `diff_ui`。

需要“定位 UI 对应源码”时：

```text
get_state → dump_ui(source="auto") → (Compose 页面) dump_ui(source="compose")
→ find_elements / hit_test → locate_code → 读候选文件 → 输出 file:line 与业务链路
```

`locate_code` 的参数就是上一步得到的 text/desc/id/Compose name/file/line/class；它只做候选排序，
不修改仓库。

## Claude Code Plugin

仓库根目录同时是一个 Claude Code plugin（`.claude-plugin/`），把 CLI、MCP Server、
UI→代码定位脚本和一套 skill/command/agent 打包在一起。它面向的典型任务是：

> “定位当前页面中的 **我的** 按钮，以及其相关代码逻辑。”

| 对象 | 名称 |
|---|---|
| GitHub 仓库 | `Jayvinz/layout-inspector-android` |
| Marketplace | `jayvinz-tools` |
| Plugin | `layout-inspector-android` |
| npm 包 | `layout-inspector-android` |
| MCP server | `layout-inspector-android` |
| CLI 命令 | `layout-inspector` |

| 组件 | 路径 | 作用 |
|---|---|---|
| MCP | `.claude-plugin/plugin.json` | 内联 `mcpServers`，启动 `${CLAUDE_PLUGIN_ROOT}/dist/mcp.js`，提供 `dump_ui` / `find_elements` / `locate_code` / `hit_test` / `screenshot` / `diff_ui` / `analyze_ui` / `tap` 等 |
| Skill | `skills/locate-ui-code/` | UI 元素 → Compose/XML 源码 → 点击/状态/业务链路的完整流程与参考资料 |
| Skill | `skills/verify-ui-change/` | 改动前后 dump、diff、规则检查、截图与交互验证 |
| Commands | `commands/locate.md`、`screen.md`、`verify.md` | `/layout-inspector-android:locate`、`:screen`、`:verify` |
| Agent | `agents/ui-code-locator.md` | 只读的 UI→代码定位子代理，适合把多步排查隔离在子上下文 |
| Script | `scripts/locate-code.mjs` | 纯 Node 内置模块的代码锚点扫描器，不需要先 `npm install` |
| Marketplace | `.claude-plugin/marketplace.json` | `jayvinz-tools` 目录；仓库根目录的第一个插件就是本项目 |

### 安装

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

### 以后添加第二个插件

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

### 发布与校验

- marketplace 和插件都托管在同一个 GitHub 仓库；推送后用户即可
  `/plugin marketplace add <owner>/<repo>` 安装，无需任何审核。
- 仓库约定为 `Jayvinz/layout-inspector-android`；如果 GitHub owner/repo 不同，同步修改
  `marketplace.json` 的 `owner.url`、`plugin.json` 的 `homepage`/`repository`
  和 README 中的安装命令。
- 发布前运行 `claude plugin validate --strict .`；CI 工作流
  `.github/workflows/validate.yml` 会跑 typecheck、测试、build，并验证
  `dist/` 与源码一致，最后执行同一校验。

### 版本号

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
- 想进一步进入 Anthropic 官方目录：在 `claude.ai/directory/manage` 提交 Plugin bundle，
  需要付费 claude.ai 计划、GitHub 仓库、自动校验和安全扫描，新 listing 还会经过人工审核；
  `claude-plugins-official` 本身不接受公开投稿。

### 典型流程

以“定位当前页面中的 我的 按钮，以及其相关代码逻辑”为例：

1. `get_state` 确认前台包、Activity、屏幕与 pid；
2. `dump_ui(source="auto", format="tree")` 得到 `uiKind` 和节点；
3. Compose 页面追加 `dump_ui(source="compose")`，取得 Composables 的 `file:line`；
4. `find_elements` / `hit_test` 锁定目标，记录 text/id/bounds/clickable；
5. `locate_code`（或直接运行定位脚本）得到字符串、布局、Compose、ViewBinding、点击处理等候选；
6. 打开候选文件验证，追 1–3 跳业务链路，输出带 `file:line` 的报告。

也可以直接调用命令：

```text
/layout-inspector-android:locate 我的
/layout-inspector-android:screen
/layout-inspector-android:verify
```

### 定位脚本

```bash
node scripts/locate-code.mjs --root . \
  --text "我的" \
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

### Agent

`ui-code-locator` 是只读子代理，适合让子上下文完成“抓屏 → 找节点 → 扫描候选 → 读代码”的
多步工作，主会话只接收结论。它默认不执行编辑、构建、安装或点击。

### 环境变量

| 变量 | 作用 |
|---|---|
| `DLI_COMPOSE_VERSION` | App 使用的 Compose 版本（默认 1.8.3） |
| `DLI_COMPOSE_INSPECTOR_JAR` | 显式指定 `inspector.jar` |
| `DLI_ANDROID_STUDIO` / `--studio` | Android Studio 安装目录 |
| `DLI_JAVA` / `--java` | Compose helper 使用的 Java |
| `DLI_ADB` / `ADB_PATH` / `--adb` | adb 路径 |
| `ANDROID_SERIAL` / `--serial` | 多设备时的目标序列号 |

插件 manifest 的 `mcpServers` 默认不注入环境变量，MCP 进程继承用户 shell 环境；需要固定
serial/adb/Studio 参数时，优先用环境变量，或在项目级 `.mcp.json` 中单独启动一份 server。

### 只读与权限

- Skills/agent 默认只读；`tap`/`swipe`/`input_text` 是显式交互工具，由用户请求触发。
- 定位/验证过程会在仓库内写 `.dli/before.json`、`.dli/after.json`、`.dli/*.png`；
  建议把 `.dli/` 加入 `.gitignore`（本仓库已加入）。
- 不要提交 dump：其中可能包含设备序列号、前台包名和界面文本。

## 分析规则

| rule | 说明 |
|---|---|
| `small_touch_target` | 可点击区域任一维度 < 48dp（可配置） |
| `overlap` | 同级可点击元素重叠超过较小者面积 50% |
| `clipped` | 超过 50% 面积被祖先裁剪（滚动内容除外） |
| `outside_parent` | 节点超出非滚动父容器 |
| `offscreen` | 可见 View 完全在屏幕外 |
| `invisible_clickable` | 不可见但仍可点击 |
| `zero_size` | 零尺寸 View / 可点击语义节点 |
| `unlabeled_clickable` | 可点击且自身与后代都没有 text/desc/id |
| `duplicate_id` | 同一个 resource-id 出现在多个可见节点 |
| `deep_nesting` | 嵌套深度超过阈值（默认 14） |

规则可按需开启：`layout-inspector analyze --rules small_touch_target,overlap`。

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

## 截图与兜底

```bash
layout-inspector shot --out screenshot.png                  # 原始分辨率
layout-inspector shot --out small.png --max-width 540       # 540x1200，约 180KB
layout-inspector shot --out small.png --scale 0.5
layout-inspector shot --out ui.png --annotate --source compose
```

- 截图始终使用 `adb exec-out screencap -p`，然后可用纯 JS（`pngjs`）做面积平均降采样；
  不依赖 ImageMagick/Sharp。
- **结构化抓取失败时自动兜底**：`dump`/`find`/`hit`/`analyze` 等命令会额外保存一张
  `dli-fallback-<时间>.png` 并在错误信息里给出路径；MCP 工具会把截图作为 image content
  和错误文本一起返回。用 `--no-fallback-screenshot` 或 `DLI_NO_FALLBACK_SCREENSHOT=1` 关闭。
- MCP `screenshot` 默认 720px 宽以控制 payload；需要原生分辨率时传 `fullResolution=true`。
- `--annotate` 的 SVG 会自动按截图缩放比例映射节点框。

### 截图坐标 ≠ 设备坐标

降采样后，agent 从图里读出的 `(x, y)` 是**图片坐标**，而 `input tap` 需要**设备坐标**。
截图输出（CLI `--json` 和 MCP 的 image 文本）都会带原始尺寸和映射系数：

```json
{
  "width": 720,
  "height": 1600,
  "originalWidth": 1080,
  "originalHeight": 2400,
  "screenWidth": 1080,
  "screenHeight": 2400,
  "scale": 0.6667,
  "coordinateMapping": {
    "imageToDevice": { "x": 1.5, "y": 1.5 },
    "deviceToImage": { "x": 0.6667, "y": 0.6667 },
    "formula": "deviceX = round(imageX * 1.5); deviceY = round(imageY * 1.5)"
  }
}
```

推荐直接用 **image-aware tap**，避免手工换算：

```bash
# 图片上读到的 (360, 800)，图片尺寸 720x1600
layout-inspector tap --image-x 360 --image-y 800 --image-width 720 --image-height 1600
# -> image (360, 800) in 720x1600 -> device (540, 1200) on 1080x2400
```

MCP：

```json
{
  "name": "tap",
  "arguments": {
    "imageX": 360,
    "imageY": 800,
    "imageWidth": 720,
    "imageHeight": 1600
  }
}
```

如果 agent 用 `find_elements` / `hit_test` 拿到的是设备坐标，可以直接传给 `tap` 的 `x/y`。
只有在做视觉识图时才需要 `coordinateMapping`。

## 限制

- `source=view` 要求 App `android:debuggable=true`；Release/未开启调试的包只能用 `source=semantics`。
- JDWP 同一时间通常只允许一个调试客户端；Android Studio 正在调试时可能无法 attach。
- `source=compose` 额外要求：本机 Android Studio、Java 17+、App 在前台、Compose inspector jar 版本匹配；
  单每次抓取约 8–12s，且会在设备上常驻一个 transport daemon（`layout-inspector compose-clean` 可清理）。
- 没有 Android Studio 时，Compose 仍可用 `source=semantics`（零依赖、文本/点击语义可用）。
- 某些 ROM（如 MIUI）的 uiautomator 返回的无障碍窗口高度小于真实屏幕，底部节点会被裁剪；
  `analyze` 会自动跳过这类触摸区测量，但 `hit` 仍可用（中心点仍落在控件内）。
- `input text` 只可靠支持 ASCII；中文输入需要额外输入法（如 ADBKeyboard）。
- 没有实时监听；每次命令都会重新抓取。

## 开发

```bash
npm test          # 45 个基于真实设备抓取 fixture 的单元测试
npm run typecheck
npm run build
npm run build:helper   # 使用本机 Android Studio 重新编译 Compose JVMTI helper
```

测试 fixture 位于 `test/fixtures/`：API 33 的 `ViewDebug.dumpv2` 二进制（Compose 应用一份、
传统 XML View 应用一份）、uiautomator XML，以及 Compose JVMTI helper 的树输出 JSON。

## 致谢 / Attribution

- 协议与命中测试算法参考 [CoXier/LayoutInspectorV2-Pro](https://github.com/CoXier/LayoutInspectorV2-Pro)（Apache-2.0）。
- ViewDebug / DDM 协议来自 AOSP `android.view.ViewDebug`、`DdmHandleViewDebug` 与 ddmlib。
- Android Studio 定位：显式配置 → 运行中进程的可执行文件路径 → 标准安装路径。进程探测结果在
  长驻 MCP 进程内缓存 **1 小时**；Windows 上首次探测因 PowerShell 启动约 1.5–2s，之后复用缓存。
- Compose 树复用本机 Android Studio 的 transport/JVMTI agent 与 `androidx.compose.ui:ui-inspection`，
  协议来自 AOSP `tools/base` 的 `transport` / `app-inspection` / `dynamic-layout-inspector` 和
  AndroidX `compose/ui/ui-inspection`（均为 Apache-2.0）。本项目不重新分发这些二进制，运行时从用户
  已安装的 Android Studio 读取。
- 本项目代码为独立实现，以 MIT License 发布；详见 `NOTICE`。
