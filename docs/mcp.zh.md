# MCP Server

[English](mcp.md) | [简体中文](mcp.zh.md)

MCP Server 通过 stdio 通信，与 CLI 驱动同一套 core。构建后直接用 `node dist/mcp.js` 启动，
或让 CLI 打印配置：`node dist/cli.js mcp --print-config`。

## 配置

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

通过 Claude Code 插件安装时不需要手写配置：插件 manifest 的 `mcpServers` 会自动启动
`${CLAUDE_PLUGIN_ROOT}/dist/mcp.js`（见 [plugin.zh.md](plugin.zh.md)）。

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
| `diff_ui` | 对比两个 `dump_ui(savePath)` 写出的 JSON |
| `tap` | 坐标或 `text/id/ref` 元素点击；支持 `imageX/imageY/imageWidth/imageHeight` 图片坐标映射 |
| `swipe` / `input_text` / `press_key` | 交互 |

## 推荐调用顺序

1. `get_state` → 确认前台 App；
2. `dump_ui(source="auto", format="tree")` 或 `find_elements` → 看界面 / 定位；
3. `tap` → 操作；
4. `screenshot` → 视觉确认；
5. `analyze_ui` → 检查小触摸区、重叠、裁剪等；
6. 修改代码后：`dump_ui(savePath=before.json)` … `dump_ui(savePath=after.json)` → `diff_ui`。

### 定位 UI 对应源码

```text
get_state → dump_ui(source="auto") → (Compose 页面) dump_ui(source="compose")
→ find_elements / hit_test → locate_code → 读候选文件 → 输出 file:line 与业务链路
```

`locate_code` 的参数就是上一步得到的 text/desc/id/Compose name/file/line/class；它只做候选排序，
不修改仓库。定位脚本 `scripts/locate-code.mjs` 的独立用法见 [plugin.zh.md](plugin.zh.md#定位脚本)。

## 环境变量

MCP 进程继承用户 shell 环境，完整变量表见 [cli.zh.md](cli.zh.md#环境变量)。需要固定
serial/adb/Studio 参数时，优先用环境变量，或在 server args 中显式传入（见上文配置示例）。
