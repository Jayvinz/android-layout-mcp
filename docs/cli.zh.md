# CLI 参考

[English](cli.md) | [简体中文](cli.zh.md)

`android-layout` CLI 与 MCP Server 驱动同一套 core。要求：Node.js ≥ 20，Android platform-tools（`adb` 在 PATH 中，或设置 `AUI_ADB` / `ADB_PATH`）。

## 安装

```bash
npm install
npm run build

# 方式一：直接调用
node dist/cli.js devices

# 方式二：链接成全局命令
npm link
android-layout devices
```

也可以不构建，直接开发模式运行：`npx tsx src/cli.ts dump`。

## CLI 快速上手

```bash
# 设备与前台 App
android-layout devices
android-layout state

# 当前界面（默认 auto，Compose 会走 semantics）
android-layout dump

# 指定数据源与深度；JSON 输出可直接交给 agent
android-layout dump --source view --depth 8 --props
android-layout dump --source both --json --out ui.json

# 按文本 / id / class / ref 查找
android-layout find "开拍" --both
android-layout find "com.example:id/submit" --by id
android-layout find "Button" --by class --match exact --clickable

# 屏幕坐标命中测试（最小面积优先，重叠时 --index 切换）
android-layout hit 540 2239 --both

# 截图（可降分辨率），附带节点框的 SVG 叠加层
android-layout shot --out screenshot.png --annotate
android-layout shot --out small.png --max-width 540
android-layout shot --out small.png --scale 0.5

# 布局 / 无障碍问题检查
android-layout analyze


# 命中测试某个设备坐标（返回全部重叠节点，面积最小的优先）
android-layout hit 540 2239 --json



# 查看某个节点的全部属性
android-layout inspect v4
android-layout inspect 0.0.0
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
| `android-layout devices` | 列出设备、型号、Android/SDK 版本；`--json` |
| `android-layout state` | 设备、屏幕、前台 App、pid、ViewRootImpl 窗口；`--package` 指定目标 App，`--json` |
| `android-layout windows` | 仅列出 JDWP 窗口（弹窗/对话框也会出现）；`--package`、`--pid`、`--json`。刻意保留：`--pid` 可指定任意进程，不只是前台 App，因此不是 `state` 的重复 |
| `android-layout dump` | 抓取 UI，`--source auto/view/semantics/dumpsys/compose/both`、`--depth`、`--max-nodes`（文本，默认 2000）、`--visible-only`、`--props`、`--package`、`--pid`、`--window`（view 源）、`--json`、`--out` |
| `android-layout find <query>` | `--by any/text/desc/id/class/ref`、`--match contains/exact/regex`、`--clickable`、`--both`、`--source auto/view/semantics/dumpsys/compose/both`、`--limit`（默认 50）、`--json` |
| `android-layout hit <x> <y>` | 命中测试；返回同一坐标下的所有候选，最小面积优先；`--source auto/view/semantics/dumpsys/compose/both`、`--index`（默认 0）、`--json` |
| `android-layout inspect <ref>` | 输出单个节点的完整 JSON（含 View 属性）；`--source auto/view/semantics/dumpsys/compose/both`、`--json` |
| `android-layout analyze` | 布局/无障碍检查；`--source auto/view/semantics/dumpsys/compose/both`、`--rules`、`--min-touch-dp`（48）、`--max-depth`（14）、`--no-props`、`--paths`、`--json` |
| `android-layout shot` | 截图；`--max-width` / `--scale` 降分辨率；`--annotate` 用 `--source auto/view/semantics/dumpsys/compose/both` 的树生成 `*.annotated.svg`；`--json`、`--json --base64` |
| `android-layout fragments` | 从 `dumpsys` 读取 Activity/Fragment 结构；`--package`、`--json`、`--all`（保留 AndroidX 记账型 Fragment） |
| `android-layout studio` | 显示用于 Compose inspection 的 Android Studio 路径、来源（explicit/env/default/process）、JBR Java；`--json` |
| `android-layout mcp` | 启动 MCP Server（stdio）；`--print-config [--client <id>]` 按指定客户端输出配置（Claude Code、Codex、VS Code、Zed 等，见[列表](mcp.zh.md#其他客户端)），`--register-view-attributes` 先开启全局 `debug_view_attributes`（会重启 App） |
| `android-layout compose-clean` | 停止常驻 transport daemon，清理 `/data/local/tmp/aui-compose` 和 App code_cache 中的 inspector jar；`--package` 指定目标 App |

所有读取树的命令都接受同一组 `--source` 取值（`auto`、`view`、`semantics`、`dumpsys`、`compose`、`both`），默认统一为 `auto`。

全局选项：`-s, --serial`、`--adb <path>`、`--timeout <ms>`、`-v, --verbose`。
Compose JVMTI 相关：`--studio <path>`、`--java <path>`、`--compose-version <v>`。
截图兜底：抓取失败时自动保存一张 `aui-fallback-<time>.png`（默认 720px 宽）；用
`--no-fallback-screenshot` 关闭。多设备时也可用 `ANDROID_SERIAL`。

## 限制与默认值

- **文本树与 JSON**：`--depth`、`--max-nodes`（默认 2000）和 `--visible-only` 只影响人类可读的文本树；被截断时最后一行会说明展示到多少节点。`--json` / `--out` 写出完整 dump（`version: 1`，不裁剪），agent 端需要自己裁剪，或改用 MCP `dump_ui` 的 `depth`/`maxNodes`。
- **搜索**：`find` 与 `hit` 的选择器默认忽略不可见/gone 节点。`contains` 不区分大小写，`exact` 区分大小写，`--match regex`（或 `/模式/标志` 形式的查询，默认标志 `i`）是真正的正则，非法正则会令命令失败。`--by class` 同时匹配全限定类名与短类名。`find` 会合并所搜索各棵树的匹配，最多返回 `--limit` 条（默认 50）；`hit` 按可见面积排序候选，用 `--index` 选择。
- **截图**：CLI `shot` 默认保持原生分辨率，只有指定 `--max-width`/`--scale` 才降采样；`--base64` 仅在同时带 `--json` 时生效。MCP `screenshot` 默认 720px 宽。
- **改前/改后**：没有 `diff` 子命令。改动前后各存一份 dump（`dump --json --out .aui/before.json`，再存 `.aui/after.json`），自行比对两份文件；ref 只在单次抓取内有效，请按 source、resource id、class、text 与 path 匹配。最后对新抓取跑 `analyze`。
- **Analyze**：`compose` 数据源不评估 `deep_nesting`；未知规则名会被忽略；在低报窗口高度的 ROM（如 MIUI）上，`small_touch_target` 会跳过底部被裁的语义节点。
- **Analyze 只读一棵树**：与页面类型匹配的那棵 —— XML 页面读 View，Compose 页面读语义树，`--source dumpsys` 读 dumpsys，`--source compose` 读 Compose。`mixed` 页面例外：View 与 Compose 区域互不重叠，两棵树都会扫描。这样同一缺陷不会按树重复上报 —— `--source dumpsys` 的抓取总带着一棵语义树，那棵树只用于补文本。`overdraw` 与 `rtl_issues` 只要抓到了 View 树就一定读它，因为只有它带原始属性表。
- **兜底行为**：`auto` 下某棵树抓取失败会跳过并给出 warning，改用另一棵树；目标包未运行时跳过 view 抓取。warning 会出现在文本树、JSON 的 `warnings` 字段，`analyze` 还会输出到 stderr。`--window` 接受 0 起始索引或名称子串，仅对 view 源生效。
- **`mcp --register-view-attributes`**：启动 server 前写入全局 `debug_view_attributes 1`（会重启 App），用于获得更丰富的 ViewDebug 属性，日常使用不需要。

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
| `deep_nesting` | 嵌套深度超过阈值（默认 14）；`compose` 数据源不评估该规则 |
| `overdraw` | 子节点在同一区域绘制了与父节点不同且不透明的背景 |
| `rtl_issues` | 硬编码 `leftMargin`/`rightMargin` 且没有对应的 `startMargin`/`endMargin`，RTL 下不会镜像 |

规则可按需开启：`android-layout analyze --rules small_touch_target,overlap`。

`overdraw` 与 `rtl_issues` 读取原始 View 属性表，因此 `analyze` 默认抓取属性。用 `--no-props`
可跳过；此时 JSON 会把这两条列在 `skipped` 中，而不是报告一个“干净”的界面。

## 截图与兜底

```bash
android-layout shot --out screenshot.png                  # 原始分辨率
android-layout shot --out small.png --max-width 540       # 540x1200，约 180KB
android-layout shot --out small.png --scale 0.5
android-layout shot --out ui.png --annotate --source compose
```

- 截图始终使用 `adb exec-out screencap -p`，然后可用纯 JS（`pngjs`）做面积平均降采样；
  不依赖 ImageMagick/Sharp。
- **结构化抓取失败时自动兜底**：`dump`/`find`/`hit`/`analyze` 等命令会额外保存一张
  `aui-fallback-<time>.png` 并在错误信息里给出路径；MCP 工具会把截图作为 image content
  和错误文本一起返回。用 `--no-fallback-screenshot` 或 `AUI_NO_FALLBACK_SCREENSHOT=1` 关闭。
- MCP `screenshot` 默认 720px 宽以控制 payload；需要原生分辨率时传 `fullResolution=true`。
- `--annotate` 的 SVG 会自动按截图缩放比例映射节点框。

### 截图坐标 ≠ 设备坐标

降采样后，从图里读出的 `(x, y)` 是**图片坐标**；**设备坐标**才是 `hit` 接受的、也是要报给用户的值。

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

换算之后再报位置或调用 `hit`：

```bash
# 图片上读到的 (360, 800)，图片尺寸 720x1600，换算到 1080x2400 屏幕即 (540, 1200)
android-layout hit 540 1200 --json
```

`find` / `hit` 与 MCP `find_elements` / `hit_test` 返回的已经是设备坐标；只有在做视觉识图时才需要 `coordinateMapping`。

## 环境变量

| 变量 | 作用 |
|---|---|
| `AUI_ADB` / `ADB_PATH` / `--adb` | adb 路径 |
| `ANDROID_SERIAL` / `--serial` | 多设备时的目标序列号 |
| `AUI_ANDROID_STUDIO` / `ANDROID_STUDIO_PATH` / `--studio` | Android Studio 安装目录（Compose inspection） |
| `AUI_JAVA` / `--java` | Compose helper 使用的 Java |
| `AUI_COMPOSE_VERSION` | App 使用的 Compose 版本（默认 1.8.3） |
| `AUI_COMPOSE_INSPECTOR_JAR` | 显式指定 `inspector.jar` |
| `AUI_COMPOSE_HELPER_JAR` | 预编译的 JVMTI helper JAR |
| `AUI_NO_FALLBACK_SCREENSHOT=1` | 关闭抓取失败时的兜底截图 |
| `AUI_JAVAC` / `AUI_JAR` | `npm run build:helper` 使用的编译器与 jar 工具 |
| `AUI_GATE_DEBUG=1` | 把 `PreToolUse` hook 的判定结果追加写入临时目录下的 `aui-android-gate.log` |
