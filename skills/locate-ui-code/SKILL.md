---
name: locate-ui-code
description: 当用户要求“定位当前页面中的 X 按钮/入口/图标”“这个页面或弹窗是哪个 Activity/Fragment/Composable/route 实现的”“这个控件或页面是哪些代码实现的”“按 UI 找已有业务逻辑”“这个文案或图标在哪个 strings.xml/代码里”“这个点击事件、可见性或状态在哪个 ViewModel/Repository”，或说 "trace this UI element to code"、"where is this button implemented"、"which screen/Activity/composable renders this"、"which file implements this screen"、"find the layout/composable for this UI"、"where does this label/click handler come from"、"map this screenshot to Android source" 时使用此技能。适用于基于真机或模拟器当前 UI，在任意规模 Android 仓库中定位 Compose/XML 源码、事件处理、状态与业务调用链。
---

# UI → 代码定位

把真机当前屏幕上的一个控件，转成可复核的源码锚点和业务链路。核心原则：**先拿设备证据，再拿代码锚点，最后读代码验证**。不要只凭文本猜实现。

## 前置检查

1. 确认 `adb` 可用且设备在线：使用 MCP `list_devices`，或 `adb devices`。若返回多台设备，先选定 `serial`，并在后续 `get_state`/`dump_ui`/`find_elements`/`hit_test`/`screenshot`/`tap` 中始终传同一个 `serial`。
2. 确认当前工作目录是目标 Android 仓库根目录；查看 `settings.gradle(.kts)`、`gradlew`、`app/`。若不在仓库内，先让用户给出仓库路径，或从最近的相关模块推断。
3. 插件 MCP 工具由 `layout-inspector-android` server 提供：`get_state`、`dump_ui`、`find_elements`、`locate_code`、`hit_test`、`screenshot`、`analyze_ui`、`diff_ui`、`tap`、`swipe`。
4. MCP 不可用时回退 CLI：
   ```bash
   mkdir -p .dli
   node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" state --json
   node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" dump --json --out .dli/current.json
   ```
   若 `dist/` 不存在，说明插件尚未构建；提示用户在插件目录运行 `npm install && npm run build`，不要伪造结果。
5. 目标 App 需在前台。前台包与仓库 applicationId 不一致时，先指出这一点，避免把别的 App 的 UI 当成目标。

## Step 1 — 采集界面证据

并行调用：

- `get_state`：设备、屏幕尺寸/密度、前台 `package`、`activity`、pid、窗口。
- `dump_ui(source="auto", format="tree", visibleOnly=true)`：得到 `uiKind`（`xml` / `compose` / `mixed`）和紧凑树。

再按 `uiKind` 决定是否补抓：

| uiKind | 追加动作 | 用途 |
|---|---|---|
| `compose` | `dump_ui(source="compose", maxNodes=2000)` | 拿到 Composable 名称、`file:line`、参数文本；8–12 秒，值得等 |
| `mixed` | 保留 view + semantics；需要源码定位时再抓 compose | 同时覆盖 XML 与 Compose 区域 |
| `xml` | 无需追加 | View 类名、resource-id、文本已足够 |
| `unknown` | 先 `dump_ui(source="semantics")` | 非调试包或抓取受限时的兜底 |

注意：

- 一次抓取的 `ref`（`v*`/`s*`/`c*`）只对当次有效。界面变化后重新抓取，不要复用旧 ref。
- `visibleOnly` 只影响 `format="tree"`；JSON 输出仍包含不可见节点，需要自己过滤。
- 用户提到“屏幕左上角那个”“截图里的位置”时，调用 `screenshot`，用返回的 `width/originalWidth/scale` 做坐标映射；不要把图片像素当设备坐标。随后用 `hit_test` 或 `tap(imageX=..., imageY=..., imageWidth=..., imageHeight=...)`。
- 只有确实需要视觉信息时才截图。文本、id、Compose 锚点通常已经够用。
- Compose 抓取失败（非调试包、未安装 Android Studio、Compose 版本不匹配）时，不要反复重试：回退到 semantics + 字符串/id 锚点，并在结论中把源码置信度标为中/低，不要声称来自 Compose 树。

## Step 1.5 — 页面级定位（没有具体控件时）

当用户问“这个页面/弹窗是哪个 Activity/Fragment/Composable/route 实现的”，跳过控件搜索，直接定位页面入口：

- XML/View 页面：`get_state` 的 `activity` → `rg 'class .*ProfileActivity'`（替换成实际类名）；在 `AndroidManifest.xml` 找声明；在 Activity 中找 `setContentView(R.layout.x)` 或 Fragment 的 `onCreateView` / Binding `inflate`。
- Compose 页面：`dump_ui(source="compose", maxNodes=2000)` 取根节点附近的 Composable 名称，再用 `locate_code` 的 `compose-callsite` 找父级和 `NavHost`/`composable("route")`。
- Dialog/BottomSheet：找 `DialogFragment`、`BottomSheetDialogFragment`、`show()` 调用；Navigation XML 中看 `<dialog>` destination。
- 只输出页面入口、布局/Composable 和 route，不继续追控件；用户明确要“页面里的 X 控件”时再进入 Step 2。

## Step 2 — 定位目标控件

按优先级搜索：

1. `find_elements(query="<文本>", by="text", match="exact", both=true)`
2. 文本不唯一时：`match="contains"`，再用 `contentDescription`、`resourceId`、`clickable`、`visible`、bounds、父路径筛选。
3. 用户给的是入口/图标而非文本：用 `by="desc"`、`by="id"`，或 `dump_ui` 树里的短类名（`Button`、`ImageButton`、`Text`）。
4. 用户给坐标或截图位置：`hit_test(x, y)`，用 `index` 切换重叠候选。

多候选时不要直接选第一个。按以下证据收窄：

- 位置（bounds 与用户描述吻合）；
- `clickable=true`；
- 可见且面积合理（排除全屏容器）；
- 同一父路径下的静态兄弟节点；
- 文本是否来自字符串资源（能解释语言差异）。

如果仍有两个以上同样合理的候选，把候选列表和判别依据交给用户，不要硬猜。

未找到目标时：

1. 目标可能在屏幕外或在折叠区域：`swipe` 滚动/展开后重新 `dump_ui` 和 `find_elements`；提醒用户旧 ref 已失效。
2. 图标按钮没有文本：改用 `by="desc"` 或 `by="id"`。
3. 弹窗/浮层可能属于另一个窗口：`get_state` 查看 windows，必要时 `dump_ui(source="view", window="<index>")`。
4. 仍找不到：进入 Step 3 用邻近静态文本、id 或类名做代码搜索兜底，按 `references/repo-search-recipes.md` 处理。

抽取锚点并记录：

- `text` / `contentDescription`
- `resourceId`（去掉包名，如 `profile_tab`）
- Compose：`compose.name`、`compose.fileName`、`compose.lineNumber`
- `className`
- `bounds`、`center`、`clickable`
- 抓取时间、`uiKind`、`source`

## Step 3 — 生成代码候选

优先调用 MCP `locate_code`（只读、无需 shell）：

```text
locate_code(
  root="<仓库根>",
  text=["我的"],
  desc=["打开个人中心"],
  id=["profile_tab"],
  composeName="ProfileTab",
  composeFile="ProfileScreen.kt",
  composeLine=120,
  className=["ProfileEntryView"],
  limit=25
)
```

`locate_code` 不可用时，运行等价脚本：

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/locate-code.mjs" \
  --root . \
  --text "我的" \
  --desc "打开个人中心" \
  --id "profile_tab" \
  --compose-name "ProfileTab" \
  --compose-file "ProfileScreen.kt" \
  --compose-line 120 \
  --class "ProfileEntryView" \
  --json
```

规则：

- 参数可重复；缺什么传什么，不要编造。`--id` 既接受 `profile_tab`，也接受 `com.example:id/profile_tab`。
- 有 `contentDescription` 时用 `--desc`，不要塞进 `--text`；自定义 View 用 `--class`。
- `anchors.strings`：文本命中的 `string` 资源（含 `values-zh` 等限定符）。
- `anchors.ids`：规范化后的 id。
- `anchors.compose`：Compose 定义（名称、文件、行）。
- `candidates[]`：按分数排序的代码位置，含 `kind`、`reason`、`snippet`。
- 先读 `anchors` 判断锚点是否可信，再按分数读取前 5–8 个候选的上下文（行号 ±15）。**分数只是线索，必须打开文件确认。**
- 仓库很大时，用 `--exclude <path>` 排除 vendored 代码、生成目录、其他产品线；测试代码默认不计入，需要时加 `--include-tests`。

候选 `kind` 的含义（常见值，完整列表以脚本输出为准）：

| kind | 含义 |
|---|---|
| `compose-definition` / `compose-callsite` | Compose 定义 / 调用点 |
| `compose-location` | inspector 报告的文件:行；可能是定义或调用点，用名称确认 |
| `layout-id` / `layout-include-chain` | XML 中定义 id / 通过 `<include>` 包含该布局的入口布局 |
| `binding-usage` / `id-usage` / `id-usage-strong` | ViewBinding 属性 / R.id 引用 / `findViewById` 或监听器 |
| `string-definition` / `string-usage` / `string-usage-compose` / `string-usage-xml` | 字符串资源定义 / 代码引用 / `stringResource` / XML `@string` |
| `layout-inflation` / `inflation` / `layout-text` | `setContentView`·`inflate`·Binding 入口 / XML 字面量文本 |
| `literal-text` / `test-tag` | 源码字面量 / `testTag`、`contentDescription` |
| `navigation` / `on-click-attr` / `click-handler` | 导航节点、`android:onClick`、处理函数 |
| `class-definition` | 自定义 View/类定义 |

若脚本无候选：换更长的静态文本、用邻近标签或 id、加 `--include-tests`、扩大 `--root`；并考虑文本来自服务端、模板拼接或格式化资源。不要用短词（1 个字）强行匹配。具体排查顺序见 `references/repo-search-recipes.md`。

## Step 4 — 按 UI 类型追踪源码

详细映射、边界情况和多模块处理见 `references/anchor-resolution.md`。

### Compose

1. 用 `compose-definition` 的 `file:line` 打开定义，读函数签名、参数、`Modifier`、`onClick`、状态读取。若只有 `compose-location`（inspector 报告的行），报告行可能是定义也可能是调用点，先用名称确认，不要仅凭行号断言。
2. 文本来自 `stringResource(R.string.x)` 时，回到 `strings.xml` 确认值；多语言下文本只是入口，真正锚点是 `R.string` 名。
3. 用 `compose-callsite` 找到父 Composable / NavHost 调用，判断该入口在哪个 route、tab、条件分支下出现。
4. 点击链路：`onClick` 形参 → 调用方传入的 lambda → ViewModel 方法 / 导航 / 回调。只追 1–2 跳，除非用户要求完整。
5. 状态链路：`collectAsStateWithLifecycle`、`LaunchedEffect`、`remember`、`uiState` 类型；再追到 ViewModel 的 `StateFlow` 来源。
6. Compose 页面上的点击可能落在 `pointerInput`、`clickable`、`combinedClickable` 或父容器；不要假设一定是 `Button`。

### XML

1. `layout-id` 定位定义布局；有 `<include>` 时用 `layout-include-chain` 找到入口布局。
2. 用 `layout-inflation` / `binding-usage` 找 Activity/Fragment/Adapter/Dialog 的 inflate 点。
3. 事件：`findViewById` + `setOnClickListener`、`binding.<id>.setOnClickListener`、DataBinding lambda、`android:onClick`（`click-handler` 候选）。
4. 从事件处理函数追到 ViewModel/Repository；若处理函数只是发事件，继续找订阅方。
5. 列表项（`item_*.xml`）通常由 Adapter/ViewHolder 绑定，业务逻辑在 Adapter、DiffUtil、item model，而不是布局本身。
6. 多 flavor / 多 module 下可能有同名 layout 或 id；比较 `sourceSets`、模块依赖和实际使用的 flavor，说明歧义。

### Semantics 兜底

只有 semantics 树时，`text`/`contentDescription` 只是界面证据，不是源码锚点。用字符串资源、`testTag`、字面量建立候选，并在结论中标注置信度较低。不要声称某个 Composable/Activity 就是来源，除非代码中能对应上。

## Step 5 — 业务链路

从 UI 到 ViewModel/UseCase/Repository 的常见结构与停止条件见 `references/business-chain.md`。

用户说“相关代码逻辑”时，至少回答：

- **入口**：Activity/Fragment/Composable/自定义 View，`file:line`。
- **交互**：点击/滑动/输入的处理函数，`file:line`。
- **状态**：UI 状态从哪里来（ViewModel、Repository、本地缓存、接口）。
- **条件**：登录、权限、实验开关、AB、空状态等是否影响可见性/点击。
- **副作用**：埋点、导航、刷新、缓存失效。

每一跳标注 `confirmed`（已读代码）或 `inferred`（仅凭命名/导航推断）。不要为了“完整”编造调用链。

## Step 6 — 输出

使用简洁的证据报告，不粘贴整文件。模板见 `references/output-template.md`，最小结构：

1. **结论**：入口 + `file:line`，一句话说明。
2. **UI 证据**：文本/描述、id、bounds、uiKind、抓取时间。
3. **代码锚点**：字符串/布局/Compose 定义。
4. **链路**：编号步骤，每步 `file:line` + `confirmed|inferred`。
5. **不确定项**：多 flavor、动态文本、服务端下发、未找到的调用方。
6. **下一步**：建议先读/改的文件与验证方式（MCP `dump_ui` + `diff_ui` + `analyze_ui`，或 CLI `layout-inspector dump`/`diff`/`analyze`、单测）。

## 质量规则

- 没有 `file:line` 的结论必须标为推断。
- 先读候选代码再下结论；`snippet` 不能替代上下文。
- 不修改代码，除非用户明确要求；本技能默认只读定位。
- 不把 `snippet` 里的局部行当成完整实现。
- 设备 UI 与仓库版本可能不一致（未重新安装、分支不同）；在结论里说明抓取时间与包名，发现明显不一致时提醒用户重新构建安装。

## 附加资源

- `references/anchor-resolution.md` — Compose/XML/字符串/导航/ViewBinding 的完整映射与边界情况。
- `references/business-chain.md` — 从控件事件追到 ViewModel/UseCase/Repository 的常见结构与停止条件。
- `references/repo-search-recipes.md` — 大仓库 `rg` 配方、排除规则、候选验证与去重。
- `references/output-template.md` — 定位报告模板与示例。
