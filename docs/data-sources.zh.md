# 数据源

[English](data-sources.md) | [简体中文](data-sources.zh.md)

`android-layout` 可以通过四个数据源抓取 Android 实时界面。下面这张矩阵就是完整对照：

## 为什么需要四个数据源

| | `view`（JDWP） | `semantics`（uiautomator） | `dumpsys`（ActivityManager） | `compose`（JVMTI） |
|---|---|---|---|---|
| 原理 | 与 LayoutInspectorV2-Pro 相同：JDWP + ViewDebug v2 | `uiautomator dump` 无障碍语义树 | `dumpsys activity` 打印每个 Activity 的 `View Hierarchy` 与 `Active Fragments` | 复用 Android Studio 的 transport daemon + JVMTI + Compose inspector |
| 依赖 | 可调试 App | 无 | 无 | 可调试 App + 本机 Android Studio + Java |
| 文本 | ✅ | ✅ | ❌ | ✅（从 Composable 参数提取） |
| resource-id | ✅ | ⚠️ 仅无障碍 id | ✅ | ❌ |
| Compose 结构 | ❌ 停在 `AndroidComposeView` | ⚠️ 只有无障碍语义 | ❌ | ✅ Composable 名称、`file:line`、bounds |
| View 属性 | ✅ 完整 | ⚠️ 部分 | ✅ 类名、id、flag 字符串，没有属性表 | ❌ |
| Fragment 实例 | ❌ | ❌ | ✅ | ❌ |
| 耗时 | ~100ms | ~0.5–3s | ~100–300ms | ~8–12s（含 daemon/agent 启动） |
| 适合 | 完整 View 类名、resource-id、padding/margin、visibility、layout params | 任意 App 的 Compose 文本、content-desc、点击区域 | 发布包上的真实 View 类名、resource-id、绝对 bounds 与 Activity/Fragment 结构，但没有文本 | Composable 名称、`file:line`、bounds、参数、重组计数 |

`dumpsys` 与 `semantics` 是互补而非替代：dumpsys 有真实 View 类名和 resource-id 但没有文本，semantics 有文本但只有无障碍类名。`--source dumpsys` 会同时抓两者，按几何位置合并，因此发布包也能回答"这个控件写了什么、由哪个类渲染"。

## auto 选择策略

`--source auto`（默认）会按当前屏幕自动选择：

| 屏幕类型 | 自动选择 | find / hit |
|---|---|---|
| 纯 XML | `view` | 只查 view |
| 纯 Compose | `semantics` | 只查 semantics |
| **XML + Compose 混合** | **view + semantics** | **自动同时查两棵树** |

分类来自 ViewDebug 树的启发式规则（`classifyUi`）：有 `ComposeView`/`AndroidComposeView`
且存在 XML 内容或 `AndroidViewsHandler` 内的 interop View → `mixed`；只有框架/Compose 包装
容器 → `compose`；没有 ComposeView → `xml`。抓取结果和 JSON 中会带 `uiKind: xml|compose|mixed|unknown`。

- 跨页面自动切换：XML 页面走 view、Compose 页面走 semantics，无需配置。
- 混合页面：`dump` 会自动打印 view + semantics 两棵树；
  `find`/`hit` 在 auto 下会自动同时搜索 view + semantics。
- `view` 源默认抓取**有输入焦点的窗口**；`--window all`（MCP 里 `window="all"`）会抓取该进程上报的全部窗口，主窗口在首位，因此弹窗或半透明 Activity 不会被静默漏掉。
- `--source both` 显式获取 view + semantics；`--source compose` 单独使用 JVMTI Compose 树。
- `hit`/MCP 的 `hit_test` 默认同时查询 view 和 semantics；显式指定 `--source`/`source`（`view`、`semantics`、`dumpsys`、`compose`）时只查那一棵树。
- `auto` 会降级而不是直接失败：某棵树抓不到时（例如 App 不可调试，或目标包未运行），跳过它并给出 warning，改用另一棵树。warning 会写入 JSON 的 `warnings` 数组并出现在文本树中；显式指定 `--source view` 时则直接报错。

## 实测能力对照（Android 13 / API 33 真机）

传统 XML View App（`com.example.demo.free.debug`）：

```
v9 Button "Re-run checks" [38,953][540,1085] {click}
   DecorView > ActionBarOverlayLayout > FrameLayout id/content > LinearLayout > LinearLayout > Button
v11 ScrollView ... {scroll}
```

- **view 源**：20 个节点，类名精确（`android.widget.Button`、`ScrollView`、`Toolbar`），文本、
  resource-id、padding/margin、layout params、clickable、scroll 全部可用。API 33 上的 TextView
  文本属性名为 `text:text`（同时兼容旧版 `text:mText`）。
- **semantics 源**：约 18 个节点，文本可用，但类名退化为无障碍角色（`Button`/`ViewGroup`），
  且 `textAllCaps` 会变成 `RE-RUN CHECKS`。
- `auto` 对 XML 界面选择 **view**（信息更完整）。

Compose App（`com.example.droidreel.debug`）：

```
v3 ComposeView / v4 AndroidComposeView ...   ← view 源到这里就结束了，没有文本
s43 TextView "开拍" / s44 Button ...          ← semantics 源有真实文本和点击区域
```

- **view 源**：只有 10 个 View 节点，内容停在 `AndroidComposeView` / `AndroidViewsHandler`，
  **没有 Compose 文本和控件**。
- **semantics 源**：49 个节点，文本、content-description、clickable、bounds、scrollable、
  checkable、enabled 都可用；零配置下的 Compose 主数据源。
- **compose 源（JVMTI）**：489 个 Composable 节点，例如：

  ```
  c0 DroidReelTheme CommunityActivity.kt:85 [0,80][1080,2356] 1080x2276
    c10 Text CommunityActivity.kt:224 "DroidReel" [44,117][937,186] {has_merged_semantics}
    c60 Text CommunityActivity.kt:255 "推荐" [236,265][304,313]
  ```

  含 Composable 名称、`file:line`、bounds、参数文本、`SYSTEM_CREATED`/`INLINED` 等 flags、
  重组/跳过计数。适合回答“这个像素属于哪个 Composable / 哪一行代码”。
- `auto` 对 Compose 界面选择 **semantics**（零依赖）；显式 `--source compose` 才走 JVMTI。

## dumpsys 数据源

`--source dumpsys` 执行 `adb shell dumpsys activity <包名>`，解析其中两段：

```
View Hierarchy:
  DecorView@37220bd[EntryActivity]
    com.google.android.material.button.MaterialButton{2009898 VFED..C.. ........ 66,352-1014,484 #7f080067 app:id/btnXml}

Active Fragments in 1cd0568:
  #0: ReportFragment{2612d81 #0 androidx.lifecycle.LifecycleDispatcher.report_fragment_tag}
      mState=5 mFragmentId=#0 mContainerId=#0 mAdded=true mHidden=false mDetached=false
```

**它独有的能力**

- **不可调试 App 上的真实层级。** 已对系统权限弹窗验证（该应用绝不可能 `debuggable`）：512 个节点，含类名、resource-id、绝对 bounds。
- **Fragment 实例。** 每个 Activity 的 `active`/`added` Fragment，含 tag、生命周期状态（`mState`）与 `mAdded`/`mHidden`/`mDetached`。其他数据源都拿不到。

**它拿不到的**

- **没有文本。** `TextView{...}` 一行不含 `mText`，只有标志位和边界。因此 `--source dumpsys` 会同时抓 `semantics`，按几何位置合并文本。
- **没有可靠的 Compose 结构。** Compose 页面只显示 `AndroidComposeView` 就停止；内部 composable 请用 `semantics` 或 `compose`。
- **混淆过的类名。** 开启混淆的发布包会打印 `b{4b4c2a6}` 而非 `ProfileFragment`，此时改用 tag 或宿主 Activity 判断。
- **不能按窗口选择。** 只 dump Activity 主层级，独立窗口里的弹窗可能不出现。

**标志位解码。** 花括号内的标志串按位置对应 `View.toString` 的各个 flag：`V`/`I`/`G` 可见性、`F` 聚焦、`E` 可用、`C` 可点击、`L` 可长按、`K` 可勾选/已勾选、`S` 选中。`V.E......` 表示可见+可用，`VFED..C..` 额外含聚焦与可点击。

**坐标系。** dumpsys 报**窗口**坐标，uiautomator 报**屏幕**坐标，差值恒为状态栏高度。合并时从两棵树实测该偏移（对文本节点 top 差取中位数，并限制在屏幕高度 10% 以内），而非写死 80px；随后只合并"平移后矩形完全相同 **且** 类名同族"的节点（`TextView`↔`MaterialTextView` 可，`TextView`↔`ImageView` 不可），且只接受唯一匹配，避免错贴标签。

**真机上的 Fragment。** 绝大多数条目是 AndroidX 的记账：`ReportFragment` 与 `LifecycleDispatcher.report_fragment_tag` 由生命周期分发自动注入，无业务含义。`notableFragments` 会把它们过滤掉，所以空列表通常意味着"单 Activity 或纯 Compose 页面"，而不是解析失败。需要看全部时用 `includeFramework`（MCP）或 `--all`（CLI）。

## Studio / JDK 版本适配

- **Studio 版本**：不假设固定安装路径；会读取 `product-info.json` / `build.txt` 得到版本号，
  `android-layout studio` 会显示 build。不同版本的 protobuf/gRPC 类名和 inspector proto 可能不同，因此
  helper 不再只依赖预编译 jar：首次使用某个 Studio build 时，会用**该 Studio 自带的 JBR
  `javac`/`jar`** 针对其 `plugins/android/lib/*.jar` 重新编译 helper，并按
  `Studio build + helper 源码 hash + 编译器版本` 缓存到
  `~/.cache/android-layout/helper/<key>/`。
- **JDK 版本**：Java 选择顺序为 `--java` → `ALM_JAVA` → `JAVA_HOME` → Studio JBR → PATH。
  显式指定的 `--java` 或 `ALM_JAVA` 若不存在，会跳过并给出 warning（继续尝试下一个候选），而不是直接失败，因此失效的覆盖配置不会让检查静默中断。
  helper 编译优先使用**与运行时 Java 同一目录下的 `javac`/`jar`**，避免 class file version
  不匹配；没有编译器时回退到仓库中已提交的 helper jar `helper/alm-compose-helper.jar`。实测：
  - Studio JBR 25 → helper class 69，可运行；
  - Microsoft OpenJDK 17（`--java` 指定）→ 自动用其 `javac` 编译 class 61，可运行。
- 若使用其他 JBR/JDK，可用：

  ```bash
  android-layout dump --source compose --java "C:/path/to/jdk/bin/java.exe"
  ```

  或显式提供已编译 helper：`ALM_COMPOSE_HELPER_JAR=/path/to/helper.jar`。
- 兼容边界：Studio 版本过旧、缺少 `layout_inspector_compose_java_proto.jar` 等工件，或
  Compose inspector proto 缺少所需消息时，helper 编译会失败并给出提示；此时请升级 Studio，
  或用 `npm run build:helper` 针对兼容的 Studio 构建，或回退到 `source=semantics`。
  当前实测版本：Android Studio `AI-262.10968.63.2622.16840690`（JBR 25）。

## Compose JVMTI 树（Android Studio 级）

```bash
android-layout dump --source compose --depth 10
android-layout find 推荐 --source compose
android-layout hit 540 2239 --source compose
android-layout analyze --source compose
android-layout dump --source compose --json --out ui.json
```

前置条件：

- App 是可调试构建（`android:debuggable=true`）；
- 本机安装 Android Studio（默认自动探测；可用 `ALM_ANDROID_STUDIO` 或 `--studio` 指定）；
  探测顺序：`--studio`/环境变量 → **正在运行的 `studio64.exe`/`studio` 进程路径** → 常见安装路径。
  优先使用开发者实际在用的那个 Studio 安装（同时覆盖自定义/Toolbox 安装）；可用 `android-layout studio`
  查看实际命中的路径和来源；
- Java 17+（优先用 Android Studio 自带 JBR；可用 `ALM_JAVA` 或 `--java` 指定）；
- Compose inspector jar 默认按 **1.8.3** 下载并缓存到 `~/.cache/android-layout/`；
  如 App 的 Compose 版本不同，设置 `ALM_COMPOSE_VERSION` 或 `ALM_COMPOSE_INSPECTOR_JAR`；
- 只支持 API 29+（Compose inspector 要求），并且 App 需在前台。

实现上复用了 Android Studio 自带的：

- `plugins/android/resources/transport/<abi>/transport`（设备端 gRPC transport daemon）
- `transport/native/agent/<abi>/libjvmtiagent.so`（JVMTI agent）
- `perfa.jar`、`layoutinspector-view-inspection.jar`
- Compose `ui-android` AAR 中的 `inspector.jar`
- 以及 Studio 的 `transport/app_inspection/view_layout_inspection/compose_layout_inspection` proto

CLI 会自动 push daemon/agent、`run-as` 安装 inspector jar、attach agent、通过 gRPC 驱动
View inspector（只拿 root view id，关闭截图以避免 78MB 的 SKP 内存峰值）和 Compose inspector。
daemon 会常驻在 `/data/local/tmp/alm-compose`，后续调用直接复用；用
`android-layout compose-clean` 停止 daemon 并清理设备侧文件。

Android Studio 定位：显式配置 → 运行中进程的可执行文件路径 → 标准安装路径。进程探测结果在
长驻 MCP 进程内缓存 **1 小时**；Windows 上首次探测因 PowerShell 启动约 1.5–2s，之后复用缓存。

### Compose 源的边界

- 能拿到：Composable 名称、包/文件名/行号、layout/render bounds、参数和文本、重组/跳过计数、
  merged/unmerged semantics 标记；
- 拿不到：Modifier 链的完整顺序、自定义 Layout 的测量过程、非参数化的内部状态；
- 文本来自 Composable 参数提取（`GetAllParameters`），不是每个节点都有；
- 速度明显慢于 view/semantics（8–12s），只在需要 Compose 结构/源码定位时使用。

### testTag 与 locator 稳定性

`semantics` 仍然保留为**零配置、零依赖**的 Compose 方案；默认也拿不到 `testTag` 作为
resource-id，除非 App 在祖先节点开启 `testTagsAsResourceId` 语义：

```kotlin
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId

Box(modifier = Modifier.semantics { testTagsAsResourceId = true }) {
    Button(modifier = Modifier.testTag("submit"), onClick = {}) {
        Text("Submit")
    }
}
```

之后 `find --by id submit` 就能定位（旧版 Compose 可能需要
`@OptIn(ExperimentalComposeUiApi::class)`）。
对 locator 稳定性要求高时，优先加 `Modifier.semantics { contentDescription = "..." }`
或 `testTag`，不要依赖文本（文本会随语言/大小写变化）。

## 抓取稳定性

每个数据源都是一次快照，而“动画中间的快照”如果没有任何标记，就是错误结论。`--settle`（CLI
`dump`/`analyze`，MCP `settle`）在抓取前先探测 `dumpsys gfxinfo <package>` 里的
“Total frames rendered”帧计数：

- 连续两个 250ms 间隔没有新帧 → `stable: true`、`reason: settled`；
- ROM 或进程不提供帧计数 → `stable: null`、`reason: unavailable`；
- 一直到 `--settle-timeout`（默认 3000ms）仍在产帧 → 照常抓取，并报 `stable: false`，附
  `framesPerInterval` 与实际测量间隔。

每次采样一次 `adb shell dumpsys gfxinfo`（真机上约 100–300ms，因此页面静止时 settle 抓取会晚
0.5–1s 开始）。它说不出“是谁在持续刷新”——那需要进程内的 `UiAutomation.waitForIdle`，也就是必须
装一个 instrumentation APK——但它回答了读 bounds 之前真正关键的问题：这一刻页面还在动吗？

`stability` 会写进 dump 文件（`version: 1` 新增可选字段）、MCP `dump_ui`/`analyze_ui` 的返回
和文本树头部。不带 `--settle` 时该字段缺省，而不是 `false`。

## 重试与几何

抓取正好撞上窗口切换时，第一次会失败、第二次成功，因此 `view`、`semantics`、`dumpsys` 各自在
300ms 后重试一次，之后才走 `auto` 的换源回退。JDWP attach 失败是确定性的（App 不可调试、已有调试器
占用），每次尝试都要付出自己的约 10s 连接超时，因此这类错误不重试。

从 `uiautomator` XML 或 `dumpsys` 解析出的矩形会做排序（`left<=right`、`top<=bottom`），与
Android 的 `Rect.sort` 一致。无障碍偶尔会返回转置的矩形，排序后 `width`/`height` 不会变成负数，
`visibleBounds`、`center`、`hit_test` 与分析规则都不会读到无效框。

## 限制与边界

- `view` 要求 App `android:debuggable=true`；Release/未开启调试的包可以用 `semantics` 或 `dumpsys`（结构 + id，没有文本）。
- JDWP 同一时间通常只允许一个调试客户端；Android Studio 正在调试时可能无法 attach。
- `compose` 额外要求：本机 Android Studio、Java 17+、App 在前台、Compose inspector jar 版本匹配；
  单次抓取约 8–12s，且会在设备上常驻一个 transport daemon（`android-layout compose-clean` 可清理）。
- 没有 Android Studio 时，Compose 仍可用 `semantics`（零依赖、文本/点击语义可用）。
- 直接画到 `Canvas` 上的内容（自定义 `View.onDraw`、`SurfaceView`、`WebView` 的像素）在 `view` 树中没有文本和子节点；`semantics` 树只能看到 App 暴露给无障碍的信息，`compose` 树只能看到 composable，看不到 canvas 绘制。
- `view` 的文本来自系统文本控件；自绘文字的自定义 View 不会暴露文本属性。
- 某些 ROM（如 MIUI）的 uiautomator 返回的无障碍窗口高度小于真实屏幕，底部节点会被裁剪；
  `analyze` 会自动跳过这类触摸区测量，但 `hit` 仍可用（中心点仍落在控件内）。
- `input text` 只可靠支持 ASCII；中文输入需要额外输入法（如 ADBKeyboard）。
- 没有实时监听；每次命令都会重新抓取。不带 `--settle`/`settle=true` 时，无法知道这次快照是否取自动画中间。
