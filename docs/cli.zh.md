# CLI 参考

[English](cli.md) | [简体中文](cli.zh.md)

`layout-inspector` CLI 与 MCP Server 驱动同一套 core。要求：Node.js ≥ 20，Android platform-tools（`adb` 在 PATH 中，或设置 `DLI_ADB` / `ADB_PATH`）。

## 安装

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

# 交互式 HTML 查看器（显式可视化请求，会打开浏览器）
layout-inspector view
layout-inspector view --no-open --out .dli/viewer.html

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
| `layout-inspector view`（别名 `open`） | 一次抓取，写入自包含的交互式 HTML 查看器并打开浏览器；`--no-open` 只写文件 |
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

## 交互式查看器

`layout-inspector view`（别名 `open`）会抓取一次当前界面，写入一个自包含的 HTML 文件，并在默认浏览器中打开。仅在用户显式要求可视化界面时使用；`dump`、`find`、`analyze`、`shot` 与验证流程都不会顺带打开浏览器。

```bash
layout-inspector view                                    # 生成 .dli/viewer.html 并打开浏览器
layout-inspector view --no-open                          # 只写文件
layout-inspector view --out .tmp-view/v.html             # 自定义路径
layout-inspector view --source semantics --max-width 720
layout-inspector view --rules small_touch_target,overlap --no-issues
layout-inspector view --json                             # path、opened、bytes、截图元数据
```

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--source` | `auto` | `auto`、`view`、`semantics`、`compose` 或 `both` |
| `--out` | `.dli/viewer.html` | HTML 输出路径，自动创建父目录 |
| `--no-open` | 关闭 | 只写文件，不启动浏览器 |
| `--max-width` | `1080` | 内嵌截图最大宽度（超过则降分辨率） |
| `--max-nodes` | `4000` | 每棵树最多序列化的节点数 |
| `--props` | 关闭 | 在节点详情中嵌入全部 ViewDebug 属性 |
| `--rules` | 全部 | 逗号分隔的分析规则 |
| `--no-issues` | 关闭 | 跳过布局/无障碍分析 |
| `--package`、`--pid`、`--window` | 前台 App | 目标选择与 `dump` 相同 |
| `--json` | 关闭 | 输出 `{path, opened, browser?, openError?, bytes, uiKind, sources, truncated, screenshot}` |

页面内嵌树、base64 截图、节点详情和问题列表；不发起任何网络请求，可直接从 `file://` 打开。它是静态快照，ref 只在本次抓取内有效。HTML 中包含设备序列号、包名与屏幕文本，请放在已 gitignore 的 `.dli/` 下，不要提交。设置 `DLI_NO_OPEN=1` 可全局禁止打开浏览器。

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

## 环境变量

| 变量 | 作用 |
|---|---|
| `DLI_ADB` / `ADB_PATH` / `--adb` | adb 路径 |
| `ANDROID_SERIAL` / `--serial` | 多设备时的目标序列号 |
| `DLI_ANDROID_STUDIO` / `--studio` | Android Studio 安装目录（Compose inspection） |
| `DLI_JAVA` / `--java` | Compose helper 使用的 Java |
| `DLI_COMPOSE_VERSION` | App 使用的 Compose 版本（默认 1.8.3） |
| `DLI_COMPOSE_INSPECTOR_JAR` | 显式指定 `inspector.jar` |
| `DLI_COMPOSE_HELPER_JAR` | 预编译的 JVMTI helper JAR |
| `DLI_NO_OPEN=1` | `view` / `open_viewer` 不启动浏览器（仍会写入 HTML） |
| `DLI_NO_FALLBACK_SCREENSHOT=1` | 关闭抓取失败时的兜底截图 |
