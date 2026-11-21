# 定位报告模板

输出目标：让另一个工程师能在 30 秒内复核结论，并知道下一步读哪里。不要粘贴整个文件。

## 模板

```markdown
## 结论
<控件> 由 `<入口类型> <名称>` 渲染，定义在 `<file>:<line>`。
点击后进入 `<handler>`（`<file>:<line>`），状态来自 `<ViewModel/Repository>`。

## UI 证据
- 设备/包/页面：<serial> / <applicationId> / <Activity 或 route>
- uiKind：compose | xml | mixed
- 命中节点：`<ref>` `<className>` "<text>" id=`<resourceId>` bounds=`[l,t][r,b]` clickable=<bool>
- 抓取时间：<ISO 时间>（界面改动后 ref 失效）

## 代码锚点
- 字符串：`<R.string.name>` → `strings.xml:<line>`
- 布局/Compose：`<file>:<line>`
- 事件/绑定：`<file>:<line>`

## 调用链
1. `<file>:<line>` — `<说明>`（confirmed）
2. `<file>:<line>` — `<说明>`（confirmed）
3. `<file>:<line>` — `<说明>`（inferred：按命名/导航推断）

## 相关逻辑
- 可见性/点击条件：<登录、权限、实验开关、空状态>
- 状态来源：<StateFlow / LiveData / Repository / 本地缓存>
- 副作用：<埋点、导航、刷新>

## 不确定项
- <多 flavor、动态文案、服务端下发、未找到调用方>

## 下一步
- 先读：`<file>:<line>`
- 建议修改：`<file>`（未修改任何代码）
- 验证：MCP `dump_ui(savePath=".dli/before.json")` → 改后 `dump_ui(savePath=".dli/after.json")` → `diff_ui(...)`；
  或 `mkdir -p .dli && node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" dump --json --out .dli/after.json`；
  再用 MCP `analyze_ui` 检查触摸区/裁剪/重叠。
```

## 示例（Compose）

```markdown
## 结论
“我的”入口由 `ProfileTab` 渲染，定义在
`feature/profile/src/main/java/.../ProfileScreen.kt:120`。
点击后调用 `ProfileViewModel.openProfile()`，状态来自 `ProfileUiState`。

## UI 证据
- 包：com.example.app / MainActivity
- uiKind：compose
- 命中：c42 Text "我的" bounds=[932,2100][1048,2200] clickable=true
- Compose：ProfileTab ProfileScreen.kt:120

## 代码锚点
- R.string.profile_tab → app/src/main/res/values-zh/strings.xml:88
- ProfileTab → feature/profile/.../ProfileScreen.kt:120
- 调用点 → feature/profile/.../ProfileRoute.kt:64

## 调用链
1. ProfileScreen.kt:120 — `Text(stringResource(R.string.profile_tab))`（confirmed）
2. ProfileScreen.kt:126 — `Modifier.clickable { onProfileClick() }`（confirmed）
3. ProfileRoute.kt:64 — `onProfileClick = viewModel::openProfile`（confirmed）
4. ProfileViewModel.kt:71 — `openProfile()` 发出 `NavigateToProfile`（confirmed）

## 不确定项
- 若存在 `src/debug` 同名 `ProfileScreen.kt`，以当前构建变体为准。
```

## 只定位不追逻辑

用户只问“这个按钮在哪”时，输出到入口 + 事件处理即可：

```markdown
“我的”按钮 → `ProfileScreen.kt:120`（Composable `ProfileTab`），
点击处理在 `ProfileScreen.kt:126` → `ProfileViewModel.openProfile()`。
需要我继续追状态/接口链路吗？
```

## 不要

- 不要粘贴超过 20 行的代码块。
- 不要把候选分数当结论。
- 不要在没有 `file:line` 时省略置信度说明。
- 不要在定位任务里顺手修改代码。
