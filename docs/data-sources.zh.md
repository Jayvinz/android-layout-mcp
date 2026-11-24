# 数据源

[English](data-sources.md) | [简体中文](data-sources.zh.md)

`android-ui` 可以通过三个数据源抓取 Android 实时界面：

| 数据源 | 原理 | 依赖 | 适合 |
|---|---|---|---|
| `view` | JDWP + ViewDebug v2 | 可调试 App | 完整 View 类名、resource-id、padding/margin、visibility、layout params |
| `semantics` | `adb shell uiautomator dump` | 无 | 任意 App 的 Compose 文本、content-desc、点击区域 |
| `compose` | Android Studio transport + JVMTI | 可调试 App + Android Studio + Java 17+ | Composable 名称、`file:line`、bounds、参数、重组计数 |

## 为什么需要三个数据源

| | `view`（JDWP） | `semantics`（uiautomator） | `compose`（JVMTI） |
|---|---|---|---|
| 原理 | 与 LayoutInspectorV2-Pro 相同：JDWP + ViewDebug v2 | `uiautomator dump` 无障碍语义树 | 复用 Android Studio 的 transport daemon + JVMTI + Compose inspector |
| 依赖 | 可调试 App | 无 | 可调试 App + 本机 Android Studio + Java |
| Jetpack Compose 结构 | ❌ 停在 `AndroidComposeView` | ⚠️ 只有无障碍语义（类名/文本） | ✅ Composable 名称、文件/行号、bounds、参数、重组计数 |
| View 属性 | ✅ 完整 | ⚠️ 部分 | ❌ |
| Compose 文本 | ❌ | ✅ | ✅（从 Composable 参数提取） |
| 速度 | ~100ms | ~0.5–3s | ~8–12s（含 daemon/agent 启动） |

## auto 选择策略

`--source auto`（默认）会按当前屏幕自动选择：

| 屏幕类型 | 自动选择 | find / hit / tap |
|---|---|---|
| 纯 XML | `view` | 只查 view |
| 纯 Compose | `semantics` | 只查 semantics |
| **XML + Compose 混合** | **view + semantics** | **自动同时查两棵树** |

分类来自 ViewDebug 树的启发式规则（`classifyUi`）：有 `ComposeView`/`AndroidComposeView`
且存在 XML 内容或 `AndroidViewsHandler` 内的 interop View → `mixed`；只有框架/Compose 包装
容器 → `compose`；没有 ComposeView → `xml`。抓取结果和 JSON 中会带 `uiKind: xml|compose|mixed|unknown`。

- 跨页面自动切换：XML 页面走 view、Compose 页面走 semantics，无需配置。
- 混合页面：`dump` 会自动打印 view + semantics 两棵树；
  `find`/`hit`/`tap --text` 在 auto 下会自动同时搜索 view + semantics。
- `--source both` 显式获取 view + semantics；`--source compose` 单独使用 JVMTI Compose 树。
- `hit`/MCP 的 `hit_test` 默认同时查询 view 和 semantics。

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

## Studio / JDK 版本适配

- **Studio 版本**：不假设固定安装路径；会读取 `product-info.json` / `build.txt` 得到版本号，
  `android-ui studio` 会显示 build。不同版本的 protobuf/gRPC 类名和 inspector proto 可能不同，因此
  helper 不再只依赖预编译 jar：首次使用某个 Studio build 时，会用**该 Studio 自带的 JBR
  `javac`/`jar`** 针对其 `plugins/android/lib/*.jar` 重新编译 helper，并按
  `Studio build + helper 源码 hash + 编译器版本` 缓存到
  `~/.cache/android-ui/helper/<key>/`。
- **JDK 版本**：Java 选择顺序为 `--java` → `AUI_JAVA` → `JAVA_HOME` → Studio JBR → PATH。
  helper 编译优先使用**与运行时 Java 同一目录下的 `javac`/`jar`**，避免 class file version
  不匹配；没有编译器时回退到仓库中已提交的 helper jar `helper/aui-compose-helper.jar`。实测：
  - Studio JBR 25 → helper class 69，可运行；
  - Microsoft OpenJDK 17（`--java` 指定）→ 自动用其 `javac` 编译 class 61，可运行。
- 若使用其他 JBR/JDK，可用：

  ```bash
  android-ui dump --source compose --java "C:/path/to/jdk/bin/java.exe"
  ```

  或显式提供已编译 helper：`AUI_COMPOSE_HELPER_JAR=/path/to/helper.jar`。
- 兼容边界：Studio 版本过旧、缺少 `layout_inspector_compose_java_proto.jar` 等工件，或
  Compose inspector proto 缺少所需消息时，helper 编译会失败并给出提示；此时请升级 Studio，
  或用 `npm run build:helper` 针对兼容的 Studio 构建，或回退到 `source=semantics`。
  当前实测版本：Android Studio `AI-262.10968.63.2622.16840690`（JBR 25）。

## Compose JVMTI 树（Android Studio 级）

```bash
android-ui dump --source compose --depth 10
android-ui find 推荐 --source compose
android-ui hit 540 2239 --source compose
android-ui analyze --source compose
android-ui dump --source compose --json --out ui.json
```

前置条件：

- App 是可调试构建（`android:debuggable=true`）；
- 本机安装 Android Studio（默认自动探测；可用 `AUI_ANDROID_STUDIO` 或 `--studio` 指定）；
  探测顺序：`--studio`/环境变量 → **正在运行的 `studio64.exe`/`studio` 进程路径** → 常见安装路径。
  优先使用开发者实际在用的那个 Studio 安装（同时覆盖自定义/Toolbox 安装）；可用 `android-ui studio`
  查看实际命中的路径和来源；
- Java 17+（优先用 Android Studio 自带 JBR；可用 `AUI_JAVA` 或 `--java` 指定）；
- Compose inspector jar 默认按 **1.8.3** 下载并缓存到 `~/.cache/android-ui/`；
  如 App 的 Compose 版本不同，设置 `AUI_COMPOSE_VERSION` 或 `AUI_COMPOSE_INSPECTOR_JAR`；
- 只支持 API 29+（Compose inspector 要求），并且 App 需在前台。

实现上复用了 Android Studio 自带的：

- `plugins/android/resources/transport/<abi>/transport`（设备端 gRPC transport daemon）
- `transport/native/agent/<abi>/libjvmtiagent.so`（JVMTI agent）
- `perfa.jar`、`layoutinspector-view-inspection.jar`
- Compose `ui-android` AAR 中的 `inspector.jar`
- 以及 Studio 的 `transport/app_inspection/view_layout_inspection/compose_layout_inspection` proto

CLI 会自动 push daemon/agent、`run-as` 安装 inspector jar、attach agent、通过 gRPC 驱动
View inspector（只拿 root view id，关闭截图以避免 78MB 的 SKP 内存峰值）和 Compose inspector。
daemon 会常驻在 `/data/local/tmp/aui-compose`，后续调用直接复用；用
`android-ui compose-clean` 停止 daemon 并清理设备侧文件。

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

## 混合界面（XML + Compose）

混合界面在 `auto` 下会自动抓取并展示 view + semantics，并让 `find`/`hit`/`tap`
同时搜索两棵树；MCP 也可以显式 `find_elements(both=true)`。

## 限制与边界

- `view` 要求 App `android:debuggable=true`；Release/未开启调试的包只能用 `semantics`。
- JDWP 同一时间通常只允许一个调试客户端；Android Studio 正在调试时可能无法 attach。
- `compose` 额外要求：本机 Android Studio、Java 17+、App 在前台、Compose inspector jar 版本匹配；
  单次抓取约 8–12s，且会在设备上常驻一个 transport daemon（`android-ui compose-clean` 可清理）。
- 没有 Android Studio 时，Compose 仍可用 `semantics`（零依赖、文本/点击语义可用）。
- 某些 ROM（如 MIUI）的 uiautomator 返回的无障碍窗口高度小于真实屏幕，底部节点会被裁剪；
  `analyze` 会自动跳过这类触摸区测量，但 `hit` 仍可用（中心点仍落在控件内）。
- `input text` 只可靠支持 ASCII；中文输入需要额外输入法（如 ADBKeyboard）。
- 没有实时监听；每次命令都会重新抓取。
