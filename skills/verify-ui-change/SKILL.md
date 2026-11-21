---
name: verify-ui-change
description: 当用户要求“验证这个 UI 改动在真机上有没有生效”“改前改后布局对比”“看看这个页面有没有回归/错位/被裁剪/点不到”，或说 "verify this UI change on device"、"compare before and after layout"、"check for layout regressions" 时使用此技能。适用于 Android XML/Compose 页面在构建安装后的设备端验证。
version: 0.1.0
---

# 真机 UI 改动验证

用设备上的真实布局树验证改动，而不是只看代码或截图。核心是**改动前留基线，改动后抓快照，再做 diff + 规则检查 + 视觉确认**。

## 前置

- 目标 App 已安装且在前台；包名与本次构建一致。
- MCP `layout-inspector-android` 可用；不可用时回退：
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" dump --json --out before.json
  node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" diff before.json after.json
  ```
- 如果用户已经改完代码并重新安装，没有基线：不要伪造 before。用“期望状态”+ `analyze_ui` + 截图 + 关键节点断言来验证，并在结论里说明没有基线。

## Step 1 — 建立基线（改动前）

在代码修改/重新构建之前：

```text
dump_ui(source="auto", savePath=".dli/before.json", format="json")
```

- 保存路径放在仓库内的 `.dli/`（若不存在则创建）；提醒用户该文件可能包含设备信息，不要提交。
- 同时记录：`get_state` 的包名、Activity、屏幕尺寸/密度、`uiKind`。
- 若改动涉及滚动页面，先滚动到目标区域再 dump；否则 before/after 可能不在同一屏。
- 若页面有动画/异步加载，等稳定后再抓（可先 `screenshot` 确认）。

## Step 2 — 改动后抓取

重新构建安装、回到同一页面、同一滚动位置：

```text
dump_ui(source="auto", savePath=".dli/after.json", format="json")
```

- `uiKind` 必须与基线一致；若从 `xml` 变成 `mixed`/`compose`，说明结构发生了本质变化，diff 可能不可比。
- 两次 dump 的 `source` 应一致。混合页面自动会带 view + semantics；如不一致，显式指定 `source="both"` 或 `source="view"`。

## Step 3 — 结构化对比

```text
diff_ui(beforePath=".dli/before.json", afterPath=".dli/after.json")
```

- 关注 `added` / `removed` / `changed`，以及 `text` 摘要。
- 对每个变化判断：预期内（本次改动）还是回归（误伤其他节点）。
- 布局位移不一定都是错误：文案变长、字体缩放、安全区变化都可能引起合理位移。
- 若 `diff_ui` 报 source 不可比，先用 `dump_ui` 重新抓同一 source。

## Step 4 — 规则检查

```text
analyze_ui(source="auto")
```

重点规则：

- `small_touch_target`：可点击区域 < 48dp。
- `overlap`：同级可点击元素重叠。
- `clipped` / `outside_parent`：被裁剪或越界（滚动内容除外）。
- `invisible_clickable`：不可见但仍可点击。
- `unlabeled_clickable`：无文本/描述/id 的点击区。
- `duplicate_id`：重复 id 导致绑定歧义。
- `deep_nesting`：层级过深。

只报告与本次改动相关的问题；不要把历史遗留问题全部算成回归。

## Step 5 — 视觉确认

需要时：

```text
screenshot(savePath=".dli/after.png", annotate=true)
```

- 默认 720px 宽；坐标是图片坐标，不是设备坐标。用返回的 `coordinateMapping` 或 `tap(imageX=..., imageY=..., imageWidth=..., imageHeight=...)`。
- `annotate=true` 会生成 `.annotated.svg`，叠加节点框，适合检查错位。
- 截图只作辅助；以 `dump_ui`/`diff_ui` 的结构化结果为准。

## Step 6 — 交互验证

若改动涉及点击/跳转：

1. `find_elements(query="<文本/ID>", both=true)` 确认目标可点击、bounds 合理。
2. `tap(ref="<ref>")` 或 `tap(text="...")`，再 `get_state` 确认页面/Activity 变化。
3. 滚动/输入同理；用 `swipe`、`input_text`。
4. 失败时先看 `tap` 返回的节点和坐标，不要连续盲点。

## 输出

```markdown
## 验证结论
通过 / 有回归 / 无法验证（原因）

## 对比
- 基线：<包> <Activity> <屏幕> uiKind=<kind> 时间=<t>
- 改动后：同上
- 节点数：before=<n> after=<n>
- 变化：新增 <n>，删除 <n>，移动/尺寸 <n>

## 预期变化
- <file/节点>：...（符合预期）

## 回归/风险
- <节点>：<规则或 diff 证据>（file:line 若可定位）

## 未验证项
- <需要登录/特定数据/滚动位置才能验证>

## 建议
- <需要修的节点/布局；或补测步骤>
```

## 质量规则

- 没有基线时明确说“无 before 基线”，不要用“应该没变”代替验证。
- diff 结论必须带节点 ref/路径或文本，不能只说“布局正常”。
- 区分预期变化与回归；不要把文案/安全区导致的合理位移报成 bug。
- 不修改代码；发现回归时给出定位线索（ref、bounds、可能的布局/Composable）。
- 验证完成后提醒 `.dli/` 产物不要提交到版本库。
