# 锚点解析：从 UI 证据到源码

这里列出 MCP/脚本给出的每类证据如何落到 Android 源码，以及容易误判的边界情况。

## Compose（JVMTI）

| 证据 | 源码落点 | 说明 |
|---|---|---|
| `compose.name` | `@Composable fun Name(...)` | 名称可能来自被内联的 composable；以 `file:line` 为准 |
| `compose.fileName` + `lineNumber` | 报告行附近最近的 `@Composable` | 报告位置可能是定义或调用点；用名称确认，不要仅凭行号断言 |
| 节点 `text` / `contentDescription` | `Text("...")`、`stringResource(R.string.x)`、`BasicText`、`AnnotatedString`、semantics modifier | 文本来自 Composable 参数提取，可能经过格式化或来自服务端 |
| `contentDescription` | `Modifier.semantics { contentDescription = ... }`、`contentDescription` 参数 | 可能是 `testTag` 或动态值 |
| `bounds` | `Modifier` 链、父布局、`Layout` 自定义测量 | 只用于确认命中，不直接对应源码行 |
| `recomposeCount` / `flags` | `remember`、`derivedStateOf`、`@Stable`、`@Immutable` | 用于判断状态/性能问题，不是定位锚点 |

定位顺序：

1. 有 `file:line` → 直接打开文件，用 `fun` 定义过滤误报。
2. 只有名称 → `rg "fun <Name>\s*\("`；优先 `@Composable` 附近。
3. 只有文本 → 字符串资源优先；没有资源则 `rg "<text>"`，再按模块和调用点筛选。
4. 找到定义后，`rg "\b<Name>\s*\("` 找调用点，确定 route/页面归属。

常见误判：

- 同名 composable 在多个模块（design system、feature）。
- `Text("我的")` 的字面量在预览、测试、示例里重复出现。
- 文本来自 `stringResource(R.string.x)`，源码里看不到中文字面量；必须追 `R.string`。
- 文本由 `String.format`、`buildAnnotatedString`、服务端字段拼接；源码里可能只有模板。
- `LazyColumn` 的 item composable 是一个函数，但业务逻辑在 item model / ViewModel。

## XML View

| 证据 | 源码落点 | 说明 |
|---|---|---|
| `resourceId`（`profile_tab`） | `res/layout*/**.xml` 的 `android:id="@+id/profile_tab"` | 布局限定符可能有多份 |
| 布局文件 | `setContentView(R.layout.x)`、`inflate(R.layout.x)`、`Fragment` 的 `onCreateView`、Binding `inflate` | 入口通常是 Activity/Fragment/Adapter/Dialog |
| `<include layout="@layout/item">` | 父布局 → 根布局链 | 脚本输出 `layout-include-chain` |
| `android:onClick` | 同名 `fun` / `void` 方法 | 方法可能在 Activity、Fragment 或 `Context` 扩展里 |
| `binding.<camelId>` | ViewBinding 属性 | `profile_tab` → `profileTab` |
| `android:text="@string/x"` | `strings.xml` + 代码中的 `R.string.x` | 文本锚点不一定在定义布局里 |
| Navigation XML `@+id/destination` | `NavHost`、`NavGraph`、`navigate(R.id.x)`、route 字符串 | Compose Navigation 里也可能用字符串 route |

定位顺序：

1. `rg '@\+id/<id>' --glob '*.xml'` 找定义。
2. 若定义在 `item_*.xml`，先找 Adapter/ViewHolder；若在 `fragment_*.xml`/`activity_*.xml`，找 inflate 点。
3. `rg 'R\.id\.<id>'` 找代码引用；`findViewById` 和 `setOnClickListener` 优先。
4. `rg '\b<camelId>\b' --glob '*.kt' --glob '*.java'` 找 ViewBinding；注意局部变量名相同的误报。
5. 有 `<include>` 时，脚本给的父链就是候选入口；多份 `include` 需要按模块和运行时页面区分。
6. 事件函数 → 找 `ViewModel` 方法名、`repository` 调用、导航。

常见误判：

- 同一个 id 在多个 layout、多个 module、多个 flavor 中出现。
- `@id/foo`（引用系统/其他布局已有 id）不是定义；定义是 `@+id/foo`。
- DataBinding 的 lambda 位置和 ViewBinding 不同；`binding.foo.setOnClickListener` 与 `android:onClickListener` 都要查。
- 自定义 View 的业务逻辑在 `onDraw`/`onTouchEvent`/`onClick`，不在布局里。
- `ViewStub`、`merge`、`tools:` 命名空间下的 id 不是运行时 id。

## 字符串与文案

文本锚点分四级，置信度从高到低：

1. `string` 资源名（`R.string.profile_title`）→ 定义 + 所有引用。
2. `testTag` / `contentDescription` → 通常是专门为自动化加的可稳定锚点。
3. XML `android:text` 字面量。
4. Kotlin/Java 字符串字面量。

注意：

- `values-zh`/`values-en` 值不同，但资源名相同；先按资源名统一。
- `%1$s`、`{name}`、`<plurals>`、`<string-array>` 需要模板匹配，不能按最终文本精确匹配。
- 服务端下发、CMS、AB 实验文案在源码里不存在；应追接口字段、数据模型、展示组件，不要硬造资源名。
- `allCaps`、`textAllCaps`、`uppercase()` 会改变真机文本；比较时用规范化后的文本。

## 导航 / 页面归属

| 形态 | 查找 |
|---|---|
| Activity | `AndroidManifest.xml` 的 `android:name`，`setContentView` |
| Fragment | `NavHostFragment`、`<fragment android:name>`、`onCreateView` |
| Compose Navigation | `NavHost`、`composable("route")`、`navigate("route")` |
| ViewPager/Tab | `FragmentPagerAdapter`、`ViewPager2`、tab 标题/索引 |
| Dialog/BottomSheet | `DialogFragment`、`BottomSheetDialogFragment`、`show()` 调用 |
| 自定义路由 | 项目自有 Router/Navigator；按字符串 route 或 destination id 搜 |

先确定“页面入口”，再确定“控件入口”。用户问“当前页面的 我的 按钮”时，页面归属和按钮事件同等重要。

## 多模块 / 多 flavor / 大仓库

- 同名资源会合并；实际生效的是当前 `applicationId` + flavor + buildType 的组合。
- 优先搜索当前模块（`settings.gradle` 里的 include、`:app` 的依赖）和当前 `sourceSets`。
- `src/main`、`src/debug`、`src/release`、`src/<flavor>` 都可能覆盖同名文件。
- 生成代码（Hilt、Room、Navigation Safe Args、DataBinding）不要当手写源码；找生成来源。
- 第三方 AAR、vendored 模块中的 UI 不要当成本仓库业务；在结论里注明。

## 置信度标注

- **高**：有 `file:line`，已读代码，锚点唯一。
- **中**：有资源/id/Compose 名称，但存在同名或入口未完全确认。
- **低**：仅文本匹配，或只有 semantics 证据；必须在输出里说明。
