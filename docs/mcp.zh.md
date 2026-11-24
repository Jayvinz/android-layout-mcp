# MCP Server

[English](mcp.md) | [简体中文](mcp.zh.md)

MCP Server 通过 stdio 通信，与 CLI 驱动同一套 core。构建后直接用 `node dist/mcp.js` 启动，
或让 CLI 打印配置：`node dist/cli.js mcp --print-config`。

## 配置

Claude Code（项目根目录 `.mcp.json`）：

```json
{
  "mcpServers": {
    "android-ui": {
      "command": "node",
      "args": ["E:/repo/android-ui-inspector/dist/mcp.js"]
    }
  }
}
```

或使用 CLI 命令：

```bash
claude mcp add android-ui -- node E:/repo/android-ui-inspector/dist/mcp.js
```

（示例按仓库名 `android-ui-inspector` 写路径；本地目录不同时用实际目录替换。）

MCP Server 也接受 Compose 相关参数：`--studio <path>`、`--java <path>`、`--compose-version <v>`。

多设备 / 自定义 adb：

```json
{
  "mcpServers": {
    "android-ui": {
      "command": "node",
      "args": [
        "E:/repo/android-ui-inspector/dist/mcp.js",
        "--serial", "<serial>",
        "--adb", "D:/Android/Sdk/platform-tools/adb.exe",
        "--timeout", "30000"
      ]
    }
  }
}
```

通过 Claude Code 插件安装时不需要手写配置：插件 manifest 的 `mcpServers` 会自动启动
`${CLAUDE_PLUGIN_ROOT}/dist/mcp.js`（见 [plugin.zh.md](plugin.zh.md)）。

### 其他客户端

这个 Server 就是一个普通的 stdio MCP Server，任何客户端都能拉起；差别只在配置外壳。`--client`
会按目标客户端的格式输出，目标文件路径写到 stderr，因此 stdout 可以直接粘贴或重定向：

```bash
node dist/cli.js mcp --print-config --client codex > config.toml
```

| `--client` | 文件 | 形状 |
|---|---|---|
| `claude`（默认）、`claude-desktop`、`codebuddy`、`workbuddy`、`cursor`、`windsurf`、`devin`、`cline`、`kiro`、`gemini`、`antigravity`、`qwen`、`trae`、`generic` | 各客户端的 MCP 配置 | `mcpServers` 对象 |
| `vscode` | `.vscode/mcp.json` | `servers`，带 `type: "stdio"` |
| `codex` | `~/.codex/config.toml` | TOML `[mcp_servers.android-ui]` |
| `zed` | `settings.json` | `context_servers`，命令放在 `command.path` |
| `opencode` | `opencode.json` | `mcp`，本地命令用数组 |
| `goose` | `~/.config/goose/config.yaml` | YAML `extensions` |
| `amp` | `~/.config/amp/settings.json` | 点号键 `amp.mcpServers` |

全局参数（`--serial`、`--adb`、`--timeout`、`--studio`、`--java`、`--compose-version`）会一并写进片段，
固定设备的选择不会在复制时丢失。`--client` 只改外壳，工具集完全相同。

客户端配置格式会变；上表的路径与形状是这些客户端在 2026 年 11 月接受的写法。Windows 上
表中 `~` 对应 `%USERPROFILE%`。

### 本机实测

| 客户端 | 版本 | 实测内容 |
|---|---|---|
| OpenCode | 1.19.5 | 生成的 `opencode.json` 可连接；`tools/list` 收到全部 14 个工具；`opencode debug skill` 发现 `.agents/skills/` 下的 4 个技能 |
| CodeBuddy Code | 2.186.0 | `mcpServers` 可连接、`list_devices` 返回真实设备；技能从 `.codebuddy/skills/` 加载。无交互运行需加 `--settings '{"enableAllProjectMcpServers":true}'`（工具调用被门禁时还要加 `-y`） |
| Codex CLI | 0.172.0 | 生成的 TOML 可解析；`codex exec` 调用 `list_devices` 返回真实设备；`.agents/skills/` 下的技能能被发现 |
| WorkBuddy | 内置 | 重启并在 GUI 中一次性启用/信任自定义 server 后，`list_devices` 返回真实设备，`inspect-current-screen` 从 `.workbuddy/skills/` 加载；只写 `mcp.json` 不会暴露工具 |

表中其余客户端按各自官方文档的 schema 配置，但未在本机实测。

### 在其他 agent 中使用技能

四个技能在 Claude Code 之外也能跑：frontmatter 只用了 `name` 与 `description`（Agent Skills 标准的可移植子集），
正文里的 CLI 兜底路径用 `AUI_ROOT` 而不是 `${CLAUDE_PLUGIN_ROOT}`。Cursor 与 VS Code 会直接读
`.claude/skills/`；Codex CLI、Gemini CLI、Cline、Goose 读 `.agents/skills/`；CodeBuddy 读
`.codebuddy/skills/`；WorkBuddy 读 `.workbuddy/skills/`：

```bash
node scripts/sync-agent-skills.mjs --dest ../my-android-app            # .agents/skills
node scripts/sync-agent-skills.mjs --dest ../my-android-app --codebuddy # .codebuddy/skills
node scripts/sync-agent-skills.mjs --dest ../my-android-app --workbuddy  # .workbuddy/skills
node scripts/sync-agent-skills.mjs --dest ../my-android-app --both      # 两种目录都写
node scripts/sync-agent-skills.mjs --global                             # ~/.agents/skills
node scripts/sync-agent-skills.mjs --dest . --check                      # 副本过期时退出码 1
```

在那个工程里把 `AUI_ROOT` 指向本插件目录（或把 `android-ui` 放进 `PATH`），CLI 兜底才能生效。
斜杠命令（`/screen`、`/locate` 等）与 `ui-code-locator` 子代理是 Claude Code 专属；其他客户端通过技能与
工具描述走同样的流程。`PreToolUse` 门禁 hook 同样是 Claude Code 专属，其他环境里 Android 工程门禁
只是技能正文中的软约束。

## 工具

| 工具 | 作用 |
|---|---|
| `list_devices` | 设备列表 |
| `get_state` | 屏幕、前台 App、pid、窗口 |
| `dump_ui` | 抓 UI；`source=auto/view/semantics/compose/both`、`format=json/tree`、`depth`、`maxNodes`、`savePath` |
| `find_elements` | 按文本/描述/id/类/ref 搜索；返回 bounds、tap 中心、clickable、完整路径 |
| `locate_code` | 根据 UI 锚点（text/desc/id/Compose file+line/class）扫描 Android 仓库，返回字符串/布局/Compose 定义和排序后的 `file:line` 候选 |
| `hit_test` | 坐标命中；默认同时返回 view 与 semantics；`source=compose` 可查 Compose 树 |
| `analyze_ui` | 布局/无障碍问题检查（规则见 [cli.zh.md](cli.zh.md#分析规则)） |
| `screenshot` | 返回 PNG image content；默认降采样到 720px 宽（`fullResolution=true` 关闭），可保存并生成 SVG 叠加层 |
| `open_viewer` | 一次抓取，写入自包含的离线 HTML 查看器（树、截图叠加层、详情、问题），并在浏览器中打开 |
| `diff_ui` | 对比两个 `dump_ui(savePath)` 写出的 JSON |
| `tap` | 坐标或 `text/id/ref` 元素点击；支持 `imageX/imageY/imageWidth/imageHeight` 图片坐标映射 |
| `swipe` / `input_text` / `press_key` | 交互 |

**Android 工程门槛。** `get_state`、`dump_ui`、`find_elements`、`locate_code`、`open_viewer` 面向 Android 工程：
`settings.gradle(.kts)`、`gradlew(.bat)`、应用 `com.android.*` 的模块 `build.gradle(.kts)`，或
`AndroidManifest.xml`。在非 Android 仓库中，只有用户明确要求查看设备页面/界面或明确提到 Android 时才调用；
`locate_code` 还要求明确提到 Android 或设备。连接了设备并不代表仓库是 Android 工程。

## 限制与默认值

| 工具 | 默认值 | 上限与行为 |
|---|---|---|
| `dump_ui` | JSON；JSON `maxNodes=800`，tree `maxNodes=1500` | `depth` 0–100；`maxNodes` 1–5000；`includeProperties` 嵌入全部 ViewDebug 属性；`savePath` 写入未裁剪的完整 dump；`visibleOnly` 只影响 `format=tree`；`window` 指定 ViewRootImpl（仅 view 源） |
| `find_elements` | `limit=30`，仅可见节点，主树 | `limit` 1–200；`includeInvisible` 可包含隐藏 View；`both=true` 同时搜索 view + semantics；`match=contains/exact/regex`，也支持 `/模式/标志` 正则 |
| `locate_code` | `limit=25` 条候选 | `limit` 1–200；`exclude` / `includeTests` 控制扫描范围；全程只读 |
| `analyze_ui` | 全部 10 条规则、48dp、深度 14 | `minTouchTargetDp` 1–200；`maxDepth` 1–100；`compose` 数据源不评估 `deep_nesting` |
| `screenshot` | 720px 宽 | `maxWidth` 1–4000；`scale` 0.05–1；`fullResolution=true` 绕过 720 默认值；`annotate` 只在同时给了 `savePath` 时才写出 SVG |
| `open_viewer` | `.aui/viewer.html`、每棵树 4000 节点、1080px | `maxNodes` 1–20000；`includeProperties` 嵌入 ViewDebug 属性（默认关闭）；`includeIssues` 执行分析（默认开启）；内嵌 JSON 8 MB 预算——先丢属性，再把节点折半至下限 200 |
| `diff_ui` | `tolerance=1` px | `tolerance` 0–100；每次只比较一棵树（`source`）；两个输入都必须是 `dump_ui(savePath=...)` 写出的 dump |
| `hit_test` | 候选 0，仅可见节点 | `index` 用于在同一坐标的多个重叠候选中选择 |
| `tap` | 第一个可见匹配 | 图片坐标映射必须同时给四个 `image*` 参数；选择器只匹配可见节点；`index` 选择第几个匹配（默认 0） |
| `swipe` | 300ms | `durationMs` 1–10000 |

`input_text` 仅支持 ASCII（空格发送为 `%s`）；`press_key` 把值原样转发给 `adb shell input keyevent`，请使用 `KEYCODE_*` 名称或数字码。抓取失败时，工具会返回错误文本和一张兜底截图（image content）。

## 推荐调用顺序

1. `get_state` → 确认前台 App；
2. `dump_ui(source="auto", format="tree")` 或 `find_elements` → 看界面 / 定位；
3. `tap` → 操作；
4. `screenshot` → 视觉确认；
5. `analyze_ui` → 检查小触摸区、重叠、裁剪等；
6. 修改代码后：`dump_ui(savePath=before.json)` … `dump_ui(savePath=after.json)` → `diff_ui`。

`open_viewer` 不在上述顺序内：只有用户显式提出可视化请求时才调用，例如“打开可视化看看”“在浏览器里打开当前页面”“可视化当前布局”或“open the UI viewer”。它会打开一个浏览器窗口，属于可见副作用，因此 `dump_ui`、`find_elements`、`analyze_ui`、`screenshot`、`diff_ui` 与验证流程都不得调用它。传 `open=false`（或设置 `AUI_NO_OPEN=1`）可只写 HTML 不打开浏览器；工具返回 `{path, opened, browser?, openError?, bytes, uiKind, sources, truncated, screenshot}`。

### 速览当前页面

```text
get_state → dump_ui(source="auto", format="tree") → find_elements（指定控件）→ 可选 analyze_ui / screenshot
```

这条路径只做观察：只有用户追问源码时才调用 `locate_code`，只有做改前/改后对比时才调用 `diff_ui`。

### 定位 UI 对应源码

```text
get_state → dump_ui(source="auto") → (Compose 页面) dump_ui(source="compose")
→ find_elements / hit_test → locate_code → 读候选文件 → 输出 file:line 与业务链路
```

`locate_code` 的参数就是上一步得到的 text/desc/id/Compose name/file/line/class；它只做候选排序，
不修改仓库。定位脚本 `scripts/locate-code.mjs` 的独立用法见 [plugin.zh.md](plugin.zh.md#定位脚本)。

### 分析当前页面/弹窗的代码与业务逻辑

```text
get_state → dump_ui(source="auto", format="tree") → (独立弹窗窗口) dump_ui(source="view", window=...)
→ locate_code → 读候选文件 → ViewModel/状态 → Repository/API/缓存 → 带 confirmed|inferred 的状态/数据链路
```

适用于“分析当前界面/弹窗的代码和业务逻辑”：先判断是页面、弹窗还是底部弹层，把各区块映射到 `file:line`，
再追 1–3 跳状态与数据。全程只读，不修改代码。`analyze-screen-logic` skill 与
`/android-ui:analyze-screen` 命令就是这条流程。

## 环境变量

MCP 进程继承用户 shell 环境，完整变量表见 [cli.zh.md](cli.zh.md#环境变量)。需要固定
serial/adb/Studio 参数时，优先用环境变量，或在 server args 中显式传入（见上文配置示例）。
