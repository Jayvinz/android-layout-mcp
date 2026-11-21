# 从控件到业务链路

“相关代码逻辑”通常不是一行 `onClick`。按下面的顺序追，避免停在 UI 层。

## 1. 先确认控件是不是入口

- `Button`、`IconButton`、`FloatingActionButton`、`ListItem`、`Tab`、`MenuItem`、`Switch` 等通常是入口。
- `Text`、`Icon`、`Image`、容器多数只是展示；但 Compose 里任何节点都可能有 `Modifier.clickable`。
- 点击可能由**父节点**处理（`clickable` 在 `Row`/`Card`/`ListItem` 上），子节点只是内容。先看命中节点的父链。
- `enabled`、`visible`、`alpha`、`clickable` 可能由外部状态控制；展示层看不到条件。

## 2. Compose 链路

按以下顺序读：

1. 定义 Composable 的 `onClick`/`onValueChange`/`onAction` 形参。
2. 调用这个 Composable 的父级，找到传入的 lambda。
3. lambda 里的 `viewModel::method`、`navigate(...)`、`onEvent(UiEvent.X)`。
4. ViewModel 方法：更新 `MutableStateFlow`、发事件、调用 UseCase/Repository。
5. UI 状态：`uiState.collectAsStateWithLifecycle()`、`StateFlow`、`remember`、`derivedStateOf`。
6. 条件分支：`if (uiState.isLoggedIn)`、`enabled = ...`、`visible = ...`、实验开关。

常见结构：

```kotlin
// Screen
Button(onClick = onProfileClick) { Text(stringResource(R.string.profile)) }

// Route
ProfileScreen(onProfileClick = viewModel::openProfile)

// ViewModel
fun openProfile() {
    _events.emit(ProfileEvent.NavigateToProfile)
}
```

注意：

- `viewModel::openProfile` 是方法引用，事件在 ViewModel 里发出，但消费可能在 Route 的 `LaunchedEffect`。
- 设计系统组件（`AppButton`）可能把 `onClick` 再包一层；追到最终 `Button` 的 `onClick`，不要停在设计系统。
- `Modifier.clickable` 在 modifier 链里，可能写在独立函数中；看 `Modifier` 的构造顺序。
- Compose 的 `Text` 可能来自 `AnnotatedString`，文本锚点不一定直接对应源码字面量。

## 3. XML 链路

1. 布局里的 `android:id`。
2. inflate 点：Activity `setContentView` / Fragment `onCreateView` / Adapter `onCreateViewHolder` / Dialog。
3. 绑定方式：`findViewById`、ViewBinding、DataBinding、`android:onClick`。
4. 监听器：`setOnClickListener`、`setOnCheckedChangeListener`、`setOnItemClickListener`。
5. 处理函数：直接业务、ViewModel 方法、UseCase、Repository。
6. 列表项：逻辑通常在 Adapter/ViewHolder/item model，而不是 item 布局。

常见结构：

```kotlin
binding.profileEntry.setOnClickListener { viewModel.openProfile() }
```

```xml
<Button android:id="@+id/profile_entry"
        android:onClick="openProfile" />
```

注意：

- DataBinding 的 lambda、`@{}` 表达式和普通 ViewBinding 是两条路径。
- `android:onClick` 方法可能在 Activity/Fragment/Context 扩展中；签名必须是 `public void method(View)`。
- Compose 里嵌入的 `AndroidView` 仍走 XML View 路径。
- `ViewStub` 的 inflate 在运行时，静态搜索可能只找到 stub 定义；继续找 `inflate()` 调用。

## 4. 状态与数据来源

按可疑度排序：

1. ViewModel：`StateFlow`/`LiveData`/`MutableState`。
2. UseCase / Interactor：业务规则、权限、实验开关。
3. Repository / DataSource：网络、数据库、缓存。
4. 全局状态：SessionManager、AppConfig、FeatureFlag、AB 实验。
5. 服务端字段：接口 DTO、CMS 配置、文案字段。

只追到与本次问题相关的层级。例如用户问“为什么这个按钮是灰的”，追到 `enabled` 的状态源即可，不必展开整个网络层。

## 5. 条件、副作用与埋点

优先检查：

- 登录/权限：`isLoggedIn`、`checkPermission`、`requireLogin`。
- 功能开关：`FeatureFlag`、`remoteConfig`、`experiment`。
- 空态/加载态：`Loading`、`Empty`、`Error`。
- 埋点：`track`、`analytics`、`logEvent`（通常是点击后的副作用）。
- 导航：`navigate`、`startActivity`、`NavController`。
- 刷新：`refresh()`、`invalidate()`、缓存失效。

## 6. 什么时候停

- 用户只问“在哪”：入口 + 事件处理，1–2 跳。
- 用户问“相关逻辑”：入口 + 事件 + 状态源 + 关键条件，2–4 跳。
- 用户问“为什么”：把导致当前表现的条件链走完，并给出证据。
- 遇到跨模块边界：先确认模块和依赖方向，再决定是否继续深入。

## 7. 常见误判

- `onClick` 里只是 `navigate`，业务在目标页面，不在当前页。
- `onClick` 里只是 `track`，真正的处理在另一个回调。
- `Text` 的文本来自调用方参数，实际文案在更上层。
- 同名方法/同名 Composable 在多个模块；按模块依赖和调用点区分。
- 测试、预览、示例代码里有相同文本或同名函数；默认排除测试，预览代码需人工判断。
- 生成代码（Hilt/Room/Nav Safe Args/DataBinding）不是业务源头。
