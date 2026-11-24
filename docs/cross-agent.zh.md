# 跨 agent 兼容

本文记录 [Android Layout MCP](https://github.com/Jayvinz/android-layout-mcp) 在 Claude Code 之外的工作方式：哪些部分可以迁移、每个客户端的确切配置形状、已在本机实测的四家，以及接入新客户端的清单。工具本身的权威参考仍是 [mcp.zh.md](mcp.zh.md)；本页是可移植性工作的工程记录。

## 哪些能迁移，哪些不能

插件分四层，只有前两层跨越 agent 边界。

| 层 | 内容 | 可移植性 |
|---|---|---|
| MCP Server | `dist/mcp.js`、stdio、11 个工具 | 所有 MCP 客户端 |
| 技能 | 4 个 `SKILL.md`，frontmatter 只有 `name` + `description` | 读取 Agent Skills 目录的客户端 |
| 斜杠命令 | 5 个 `commands/*.md`，`$ARGUMENTS` 语法 | 仅 Claude Code |
| 子代理 | `agents/ui-code-locator.md`，`model: inherit` / `color` | 仅 Claude Code |
| 门禁与分发 | `hooks/hooks.json` 的 `PreToolUse`、`plugin.json`、marketplace | 仅 Claude Code |

技能可移植靠两个性质：frontmatter 只用 `name` 与 `description`；CLI 兜底路径用 `$AUI_ROOT/dist/cli.js`，而不是 `${CLAUDE_PLUGIN_ROOT}/dist/cli.js`。在 Claude Code 里 `AUI_ROOT` 就是 `${CLAUDE_PLUGIN_ROOT}`；其他地方它是你的插件 checkout，或者把 `android-layout` 放进 `PATH`。技能的可执行命令里不会硬编码 Claude 专属路径，`test/agent-portability.test.ts` 强制这一点。

Android 工程门禁只有在 Claude Code 里才是硬性的 `PreToolUse` hook。其他客户端里它是写进每个技能正文的软规则：只在 Android 工程中调用设备工具，或用户明确要求查看设备页面时才调用。

## 客户端配置外壳

Server 通过 stdio 讲 MCP，所有客户端都能启动它；不同的只是 JSON/TOML/YAML 外壳。生成方式：

```bash
node dist/cli.js mcp --print-config --client <id>
```

片段写到 stdout，目标路径提示写到 stderr，因此 `--client codex > config.toml` 得到的是干净文件。设备与 Compose 参数（`--serial`、`--adb`、`--timeout`、`--studio`、`--java`、`--compose-version`）会一并写进片段；`--client` 只改外壳，不改工具集。

20 个客户端 id 分布在 7 种形状里：

| 形状 | 客户端 id | 目标文件 |
|---|---|---|
| `mcpServers` 对象 | `claude`（默认）、`claude-desktop`、`codebuddy`、`workbuddy`、`cursor`、`windsurf`、`devin`、`cline`、`kiro`、`gemini`、`antigravity`、`qwen`、`trae`、`generic` | 各客户端的 MCP 配置 |
| `servers` + `type: "stdio"` | `vscode` | `.vscode/mcp.json` |
| TOML `[mcp_servers.android-layout]` | `codex` | `~/.codex/config.toml` |
| `context_servers` + `command.path` | `zed` | `settings.json` |
| `mcp` + 本地命令数组 | `opencode` | `opencode.json` |
| YAML `extensions` | `goose` | `~/.config/goose/config.yaml` |
| 点号键 `amp.mcpServers` | `amp` | `~/.config/amp/settings.json` |

id 定义在 `src/core/mcp-config.ts`；CLI 的 `--client` choices 直接从该数组派生，所以在那里加 id 就能被 CLI 接受。上表路径与形状是这些客户端在 2026 年 11 月接受的写法。

## 本机实测

四家在本机做了端到端验证。"验证"指生成的配置被接受，且至少一次 MCP 调用返回了真实设备数据，不只是握手成功。

| 客户端 | 版本 | 验证内容 | 需要记住的坑 |
|---|---|---|---|
| OpenCode | 1.19.5 | `opencode mcp list` 显示已连接；`tools/list` 收到全部 11 个工具；`opencode debug skill` 发现 `.agents/skills/` 下的 4 个技能 | 配置校验严格；`type: "local"` 加命令数组才是被接受的形状 |
| CodeBuddy Code | 2.186.0 | `mcp__android-layout__list_devices` 返回真实设备；技能从 `.codebuddy/skills/` 加载 | 项目级 server 需要一次性审批；无交互运行要加 `--settings '{"enableAllProjectMcpServers":true}'`，工具被门禁时还要 `-y` |
| Codex CLI | 0.172.0 | 生成的 TOML 可解析；`codex exec` 调用 `list_devices` 返回真实设备；`.agents/skills/` 下的技能能被发现 | 非交互 shell 里 `codex exec` 会等 stdin，需从 `/dev/null` 重定向；自定义 provider 必须用 `env_key`，inline `api_key` 会被忽略 |
| WorkBuddy | 内置 | 重启并在 GUI 中一次性启用后，`list_devices` 返回真实设备，`inspect-current-screen` 从 `.workbuddy/skills/` 加载 | 只写 `mcp.json` 不会暴露工具，GUI 启用/信任步骤不能省 |

其余 16 家按各自官方文档的 schema 配置，但未在本机运行。未实测的条目按"配置形状已核对、运行时未验证"看待。

## 把技能装到其他地方

`skills/` 是 Claude Code 插件布局，其他 agent 读不同目录，用下面的命令复制未改动的 `SKILL.md`：

```bash
npm run sync-skills                                          # 当前工程的 .agents/skills
node scripts/sync-agent-skills.mjs --dest ../my-app          # 另一个工程
node scripts/sync-agent-skills.mjs --dest ../my-app --codebuddy
node scripts/sync-agent-skills.mjs --dest ../my-app --workbuddy
node scripts/sync-agent-skills.mjs --dest ../my-app --both
node scripts/sync-agent-skills.mjs --dest ../my-app --both --workbuddy
node scripts/sync-agent-skills.mjs --global                   # ~/.agents/skills
node scripts/sync-agent-skills.mjs --dest . --check           # 副本过期时退出码 1
```

| 目标 | 目录 | 客户端 |
|---|---|---|
| 默认 | `.agents/skills/` | Codex CLI、Gemini CLI、Cline、Goose |
| `--codebuddy` | `.codebuddy/skills/` | CodeBuddy Code |
| `--workbuddy` | `.workbuddy/skills/` | WorkBuddy，项目级或用户级 |
| 无需复制 | `.claude/skills/` | Cursor、VS Code 直接读取 |

`--both` 只表示前两个目标：`.agents/skills` 加 `.codebuddy/skills`。要写三处需再叠加 `--workbuddy`。脚本零依赖，只覆盖这 4 个技能，不会删除目标目录里的其他技能；`--check` 会分别校验每个选中的目标。

Cursor 与 VS Code 无需复制就能发现 `.claude/skills/`，因此把插件技能放在那里即可。

## 接入新客户端

按这个清单做，避免新客户端悄悄腐坏：

1. 在 `src/core/mcp-config.ts` 的 `MCP_CLIENT_IDS` 加 id。
2. 在 `CLIENTS` 表加条目，写清 `family` 和确切目标路径。能复用形状就复用；新形状需要在 `mcpClientConfig` 里加分支。
3. 在 `test/mcp-config.test.ts` 加一条形状断言。
4. 更新 `docs/mcp.md` 与 `docs/mcp.zh.md` 的客户端表，以及两份 README 的 id 列表。兼容测试会要求四处都提到每个 id，否则失败。
5. 更新 `AGENTS.md` 的客户端数量（当前 20）和本文。
6. 如果能实际运行该客户端，在"本机实测"表加一行，写清版本与验证内容；否则留在未实测集合里。
7. 跑 `npm test`。仅加客户端不需要升发布版本，server 与工具没变。

## 兼容测试

三套测试守着这份契约，全部不需要设备或网络：

| 测试文件 | 守护内容 |
|---|---|
| `test/mcp-config.test.ts` | 每个客户端输出非空且形状正确；TOML 转义 Windows 路径；未知 id 被拒绝 |
| `test/agent-portability.test.ts` | 技能 frontmatter 保持可移植；可执行路径里没有 `${CLAUDE_PLUGIN_ROOT}`；同步副本逐字节一致且 `--check` 能发现过期副本 |
| `test/cross-agent-compat.test.ts` | 代码、CLI 与文档的客户端列表一致；每种外壳保持不变；同步标志与技能目录匹配文档矩阵 |

用 `npm test` 跑全部。新增客户端 id、改名技能目录、或文档漏掉某个客户端，都会在发布前让这些测试失败。

## 已知限制

- 配置格式会变。表格反映 2026 年 11 月的写法，告诉用户路径前先复核。
- 技能可移植，但斜杠命令、子代理、`PreToolUse` hook 不可移植。不要给 `SKILL.md` 加 agent 专属 frontmatter 字段，否则同步脚本会把其他客户端不认的字段一起发出去。
- 只有四家做了运行时验证，其余 16 家是按各自 schema 文档配置的。
- 所有客户端拿到的是同一套 11 个工具。差异在配置形状、技能发现与审批流程，不在工具行为。
