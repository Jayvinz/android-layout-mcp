# MCP Server

[English](mcp.md) | [简体中文](mcp.zh.md)

MCP Server 通过 stdio 通信，与 CLI 驱动同一套 core，因此任何 MCP 客户端都能驱动它。构建后用
`node dist/mcp.js` 启动，或用 `node dist/cli.js mcp --print-config --client <id>` 打印适配 20 个客户端的
配置（下面默认的 `mcpServers` 形状适用于 Claude Code 等多个客户端）。完整客户端矩阵与实测记录见
[跨 agent 指南](cross-agent.zh.md)。

## 配置

Claude Code（项目根目录 `.mcp.json`）：

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

或使用 CLI 命令：

```bash
claude mcp add android-layout -- node E:/repo/android-layout-mcp/dist/mcp.js
```

（示例按仓库名 `android-layout` 写路径；本地目录不同时用实际目录替换。）

MCP Server 也接受 Compose 相关参数：`--studio <path>`、`--java <path>`、`--compose-version <v>`。

多设备 / 自定义 adb：

```json
{
  "mcpServers": {
    "android-layout": {
      "command": "node",
      "args": [
        "E:/repo/android-layout-mcp/dist/mcp.js",
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
按目标客户端的格式输出，片段走 stdout，目标文件路径走 stderr：

```bash
node dist/cli.js mcp --print-config --client codex > config.toml
```

20 个 id 是 `claude`（默认）、`claude-desktop`、`codebuddy`、`workbuddy`、`cursor`、`windsurf`、
`devin`、`cline`、`kiro`、`gemini`、`antigravity`、`qwen`、`trae`、`vscode`、`codex`、`zed`、
`opencode`、`goose`、`amp` 与 `generic`。各客户端的目标文件与外壳形状、技能安装参数，见
[cross-agent.zh.md](cross-agent.zh.md#客户端配置外壳)。

有 4 个客户端在本机做过完整验证：OpenCode、CodeBuddy Code、Codex CLI 与 WorkBuddy。版本与
逐个客户端的坑见 [cross-agent.zh.md](cross-agent.zh.md#本机实测)。

全局参数（`--serial`、`--adb`、`--timeout`、`--studio`、`--java`、`--compose-version`）会一并写进片段，
固定设备的选择不会在复制时丢失。`--client` 只改外壳，工具集完全相同。

客户端配置格式会变；把上面记下的路径与形状当作 2026 年 11 月的快照，Windows 上路径开头的 `~` 对应 `%USERPROFILE%`。

## 工具

| 工具 | 作用 |
|---|---|
| `list_devices` | 设备列表 |
| `get_state` | 屏幕、前台 App、pid、窗口 |
| `dump_ui` | 抓 UI；`source=auto/view/semantics/dumpsys/compose/both`、`format=json/tree/compact/flat`、`depth`、`maxNodes`、`includeProperties`、`visibleOnly`、`settle`、`settleTimeoutMs`、`window`（索引、名称子串或 `all`）、`savePath`。JSON 按抓到的树各给一个键（`view`、`semantics`、`dumpsys`、`compose`）；`window=all` 时返回 `view.windows`（每个窗口的 name + `roots`，主窗口带 `selected`），不再返回单个 `view.roots`；`source=dumpsys` 时额外返回 `dumpsys` 对象，含 `activity`、`captureMs`、`labelledNodes`、`fragments`、`roots`；`format=compact/flat` 返回裁剪后的树（`nodes` 而非 `roots`）与 `stats` |
| `find_elements` | 按文本/描述/id/类/ref 搜索；返回 bounds、中心点、clickable、完整路径；`window` 指定搜索哪个 view 窗口（默认焦点窗口） |
| `locate_code` | 根据 UI 锚点（text/desc/id/Compose file+line/class）扫描 Android 仓库，返回字符串/布局/Compose 定义和排序后的 `file:line` 候选 |
| `hit_test` | 坐标命中；默认（`source=auto`）同时查 view 与 semantics；显式指定 `source`（`view`、`semantics`、`dumpsys` 或 `compose`）时只命中该棵树 |
| `analyze_ui` | 布局/无障碍问题检查，覆盖全部 12 条规则（见 [cli.zh.md](cli.zh.md#分析规则)）；默认抓取原始 View 属性，`overdraw` 与 `rtl_issues` 才能生效；只扫描 `source` 选中的那棵树（`mixed` 页面两棵都扫），同一缺陷不会按树重复报；`settle` 先等动画停再抓取，并附带 `stability` 对象
| `screenshot` | 返回 PNG image content；默认降采样到 720px 宽（`fullResolution=true` 关闭），可保存并生成 SVG 叠加层 |
| `list_fragments` | 从 `dumpsys` 读取 Activity/Fragment 结构；不可调试 App 同样可用。默认过滤 AndroidX 记账型 Fragment，`includeFramework` 可保留 |

**Android 工程门槛。** 全部 9 个工具都会接触设备，门槛完全一致：`list_devices`、`get_state`、`dump_ui`、
`find_elements`、`locate_code`、`hit_test`、`analyze_ui`、`list_fragments`、`screenshot`。它们面向 Android 工程：
`settings.gradle(.kts)`、`gradlew(.bat)`、应用 `com.android.*` 的模块 `build.gradle(.kts)`，或
`AndroidManifest.xml`。在非 Android 仓库中，所有接触设备的工具都会被拒绝，只有用户明确要求查看设备页面/界面
或明确提到 Android 时才放行；`locate_code` 更严格，需要 Android 工程或明确提到 Android，因为仅有设备线索
不足以支撑源码扫描。连接了设备并不代表仓库是 Android 工程。9 个工具的描述里都重复了这一行规则：
“Android repos only; non-Android: call only on an explicit device/screen request or Android mention.”
`PreToolUse` hook 执行的是同一套 9 个工具的门槛，因此 hook 与工具描述不会走偏。

## 限制与默认值

| 工具 | 默认值 | 上限与行为 |
|---|---|---|
| `dump_ui` | JSON；JSON `maxNodes=800`，tree `maxNodes=1500` | `depth` 0–100；`maxNodes` 1–5000（同样作用于 `compact`/`flat`）；`includeProperties` 嵌入全部 ViewDebug 属性；`savePath` 写入未裁剪的完整 dump；`visibleOnly` 只影响 `format=tree`；`window` 指定 ViewRootImpl（仅 view 源）：索引、名称子串或 `all`，`all` 抓取该 App 的全部窗口（上限 8 个，失败的窗口逐条告警），并在这些窗口间共享 `maxNodes` 预算；默认抓取焦点窗口，因此它既是默认窗口，也是 `all` 下标记 `selected` 的主窗口；`compact`/`flat` 丢弃无 text/content-desc/交互/状态的节点，丢弃不可见与零尺寸节点，并把子节点上提（`stats.kept`/`stats.dropped` 说明删了多少）；`settle` 每 250ms 采样一次 `dumpsys gfxinfo`，返回 `stability`（`stable: true/false/null`、`framesPerInterval`、可选 `hint`），`settleTimeoutMs` 上限 250–15000。JSON 的 `hint` 会给出本次数据源的 ref 前缀：view `v*`、semantics `s*`、compose `c*`、dumpsys `d*` |
| `find_elements` | `limit=30`，仅可见节点，主树 | `limit` 1–200；`includeInvisible` 可包含隐藏 View；`both=true` 同时搜索 view + semantics；`match=contains/exact/regex`，也支持 `/模式/标志` 正则；`window` 选择要搜索的 view 窗口（`get_state` 列出的索引或名称子串），因此未获得焦点的弹窗也能直接搜索 |
| `locate_code` | `limit=25` 条候选 | `limit` 1–200；`exclude` / `includeTests` 控制扫描范围；全程只读 |
| `analyze_ui` | 全部 12 条规则、48dp、深度 14、`includeProperties=true` | `minTouchTargetDp` 1–200；`maxDepth` 1–100；`compose` 数据源不评估 `deep_nesting`；`includeProperties=false` 跳过原始 View 抓取，`overdraw`/`rtl_issues` 会列在 `skipped` 中；`settle`/`settleTimeoutMs` 与 `dump_ui` 相同 |
| `screenshot` | 720px 宽 | `maxWidth` 1–4000；`scale` 0.05–1；`fullResolution=true` 绕过 720 默认值；`annotate` 只在同时给了 `savePath` 时才写出 SVG |
| `hit_test` | 候选 0，仅可见节点，`source=auto`（view + semantics） | `index` 用于在同一坐标的多个重叠候选中选择；显式指定 `source` 时只查那一棵树；`window` 选择 view 窗口（默认焦点窗口） |

抓取失败时，工具会返回错误文本和一张兜底截图（image content）。

## 推荐调用顺序

1. `get_state` → 确认前台 App；
2. `dump_ui(source="auto", format="tree")` 或 `find_elements` → 看界面 / 定位；
3. `screenshot` → 视觉确认；
4. `analyze_ui` → 检查小触摸区、重叠、裁剪等；


### 速览当前页面

```text
get_state → dump_ui(source="auto", format="tree") → find_elements（指定控件）→ 可选 analyze_ui / screenshot
```

这条路径只做观察：只有用户追问源码时才调用 `locate_code`。

### 定位 UI 对应源码

```text
get_state → dump_ui(source="auto") → (Compose 页面) dump_ui(source="compose")
→ find_elements / hit_test → locate_code → 读候选文件 → 输出 file:line 与业务链路
```

`locate_code` 的参数就是上一步得到的 text/desc/id/Compose name/file/line/class；它只做候选排序，
不修改仓库。定位脚本 `scripts/locate-code.mjs` 的独立用法见 [plugin.zh.md](plugin.zh.md#定位脚本)。

### 从 UI 区块溯源业务代码与逻辑

```text
get_state → dump_ui(source="auto", format="tree") → （弹窗/对话框）dump_ui(source="view", window="all")
→ locate_code → 读候选文件 → ViewModel/状态 → Repository/API/缓存 → 带 confirmed|inferred 的状态/数据链路
```

适用于“这块区域的业务逻辑”“从这块 UI 追到业务代码”：以用户指认的区块为切入点，先判断它属于页面、弹窗还是底部弹层，把各区块映射到 `file:line`，
再追 1–3 跳状态与数据。全程只读，不修改代码。`trace-ui-logic` skill 与
`/android-layout:trace-logic` 命令就是这条流程。

## 环境变量

MCP 进程继承用户 shell 环境，完整变量表见 [cli.zh.md](cli.zh.md#环境变量)。需要固定
serial/adb/Studio 参数时，优先用环境变量，或在 server args 中显式传入（见上文配置示例）。
