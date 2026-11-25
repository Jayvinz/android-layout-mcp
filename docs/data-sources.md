# Data sources

[English](data-sources.md) | [简体中文](data-sources.zh.md)

`android-layout` can capture a live Android screen through four sources. The matrix below is the whole comparison:

## Why four data sources

| | `view` (JDWP) | `semantics` (uiautomator) | `dumpsys` (ActivityManager) | `compose` (JVMTI) |
|---|---|---|---|---|
| Principle | Same as LayoutInspectorV2-Pro: JDWP + ViewDebug v2 | `uiautomator dump` accessibility semantics tree | `dumpsys activity` prints each Activity's `View Hierarchy` and `Active Fragments` | Reuses Android Studio's transport daemon + JVMTI + Compose inspector |
| Requires | Debuggable app | Nothing | Nothing | Debuggable app + local Android Studio + Java |
| Text | ✅ | ✅ | ❌ | ✅ (from Composable parameters) |
| Resource ids | ✅ | ⚠️ accessibility ids only | ✅ | ❌ |
| Compose structure | ❌ stops at `AndroidComposeView` | ⚠️ accessibility semantics only | ❌ | ✅ Composable names, `file:line`, bounds |
| View properties | ✅ complete | ⚠️ partial | ✅ classes, ids, and flag string, no property map | ❌ |
| Fragment instances | ❌ | ❌ | ✅ | ❌ |
| Speed | ~100ms | ~0.5–3s | ~100–300ms | ~8–12s (including daemon/agent startup) |
| Best for | Full View classes, resource ids, padding/margins, visibility, layout params | Compose text, content descriptions, clickable bounds on any app | Real View classes, ids, bounds, and Activity/Fragment structure on a release build, no text | Composable names, `file:line`, bounds, parameters, recomposition counts |

`dumpsys` and `semantics` complement each other: dumpsys has the real View classes and resource ids but no text, while the semantics tree has the text but reports accessibility classes. `--source dumpsys` captures both and merges them by geometry, so a release build still answers what an element says and which class renders it.

## auto selection policy

`--source auto` (the default) selects per the current screen:

| Screen type | Auto selection | find / hit |
|---|---|---|
| Pure XML | `view` | view only |
| Pure Compose | `semantics` | semantics only |
| **Mixed XML + Compose** | **view + semantics** | **searches both trees automatically** |

The classification comes from a heuristic over the ViewDebug tree (`classifyUi`): a `ComposeView`/`AndroidComposeView` with XML content or interop views inside `AndroidViewsHandler` → `mixed`; only framework/Compose wrapper containers → `compose`; no ComposeView → `xml`. Capture results and JSON carry `uiKind: xml|compose|mixed|unknown`.

- Automatic cross-page switching: XML pages go to view, Compose pages to semantics — no configuration needed.
- Mixed pages: `dump` prints both view + semantics trees; `find`/`hit` search both trees under auto.
- `--source both` explicitly captures view + semantics; `--source compose` uses the JVMTI Compose tree alone.
- `hit` / MCP `hit_test` query view and semantics together by default; an explicit `--source`/`source` (`view`, `semantics`, `dumpsys`, `compose`) queries only that tree.
- `auto` degrades instead of failing: when one tree cannot be captured (for example a non-debuggable app, or a package that is not running), it is skipped with a warning and the other tree is used. Warnings appear in the JSON `warnings` array and in the text tree. An explicit `--source view` fails instead.

## Measured results (Android 13 / API 33 real device)

Traditional XML View app (`com.example.demo.free.debug`):

```
v9 Button "Re-run checks" [38,953][540,1085] {click}
   DecorView > ActionBarOverlayLayout > FrameLayout id/content > LinearLayout > LinearLayout > Button
v11 ScrollView ... {scroll}
```

- **view source**: 20 nodes, exact class names (`android.widget.Button`, `ScrollView`, `Toolbar`); text, resource-id, padding/margin, layout params, clickable, scroll all available. On API 33 the TextView text property is `text:text` (legacy `text:mText` also supported).
- **semantics source**: about 18 nodes; text works, but class names degrade to accessibility roles (`Button`/`ViewGroup`), and `textAllCaps` becomes `RE-RUN CHECKS`.
- `auto` picks **view** for XML screens (more complete information).

Compose app (`com.example.droidreel.debug`):

```
v3 ComposeView / v4 AndroidComposeView ...   ← the view source ends here, no text
s43 TextView "开拍" / s44 Button ...          ← the semantics source has real text and clickable bounds
```

- **view source**: only 10 View nodes; content stops at `AndroidComposeView` / `AndroidViewsHandler`, **no Compose text or elements**.
- **semantics source**: 49 nodes; text, content-description, clickable, bounds, scrollable, checkable, enabled all available — the main zero-config Compose source.
- **compose source (JVMTI)**: 489 Composable nodes, e.g.:

  ```
  c0 DroidReelTheme CommunityActivity.kt:85 [0,80][1080,2356] 1080x2276
    c10 Text CommunityActivity.kt:224 "DroidReel" [44,117][937,186] {has_merged_semantics}
    c60 Text CommunityActivity.kt:255 "推荐" [236,265][304,313]
  ```

  Includes Composable names, `file:line`, bounds, parameter text, flags such as `SYSTEM_CREATED`/`INLINED`, and recomposition/skip counts. Ideal for answering "which Composable / which line of code does this pixel belong to".
- `auto` picks **semantics** for Compose screens (zero dependencies); only explicit `--source compose` goes through JVMTI.

## dumpsys source

`--source dumpsys` runs `adb shell dumpsys activity <package>` and parses two sections of the output:

```
View Hierarchy:
  DecorView@37220bd[EntryActivity]
    android.widget.LinearLayout{cbfb6b2 V.E...... ........ 0,0-1080,2356}
      com.google.android.material.button.MaterialButton{2009898 VFED..C.. ........ 66,352-1014,484 #7f080067 app:id/btnXml}

Active Fragments in 1cd0568:
  #0: ReportFragment{2612d81 #0 androidx.lifecycle.LifecycleDispatcher.report_fragment_tag}
      mState=5 mFragmentId=#0 mContainerId=#0 mAdded=true mHidden=false mDetached=false
```

**What it gives you that nothing else does**

- **A real hierarchy on a non-debuggable app.** Verified against a system permission dialog, which can never be `debuggable`: 512 nodes with class names, resource ids, and absolute bounds.
- **Fragment instances.** `active`/`added` fragments per Activity with tag, lifecycle state (`mState`), and `mAdded`/`mHidden`/`mDetached`. No other source reports fragments.

**What it does not give you**

- **No text.** A `TextView{...}` line has no `mText`; the flags and bounds are there, the string is not. `--source dumpsys` therefore also captures `semantics` and merges text by geometry (see below).
- **No reliable Compose structure.** A Compose screen shows `AndroidComposeView` and stops; use `semantics` or `compose` for the composables inside.
- **Obfuscated names, if the app is minified.** A release build prints `b{4b4c2a6}` instead of `ProfileFragment`; match by tag or by the hosting Activity instead.
- **No per-window selection.** It dumps the Activity's main hierarchy; popups in separate windows may not appear.

**Flag decoding.** The in-brace flag string is positional, one character per `View.toString` flag: `V`/`I`/`G` visibility, `F` focused, `E` enabled, `C` clickable, `L` long-clickable, `K` checkable/checked, `S` selected. `V.E......` is visible+enabled, `VFED..C..` adds focused+clickable.

**Geometry.** dumpsys reports **window** coordinates while uiautomator reports **screen** coordinates; the constant difference is the status bar. The merge measures that offset from the two trees (median of text-node top differences, bounded to 10% of screen height) instead of hard-coding 80 px, then matches nodes whose shifted rects are identical **and** whose classes are in the same family (`TextView`↔`MaterialTextView` yes, `TextView`↔`ImageView` no). Only unique matches are merged, so a coarse fit cannot attach the wrong label.

**Fragments on a real device.** Most entries are AndroidX bookkeeping: `ReportFragment` and `LifecycleDispatcher.report_fragment_tag` are injected for lifecycle dispatch and carry no product meaning. `notableFragments` filters them out, so an empty list usually means "single Activity or Compose-only screen", not "the parser failed". Pass `includeFramework` (MCP) or `--all` (CLI) to see them.

## Studio / JDK compatibility

- **Studio version**: no fixed install path is assumed; the version is read from `product-info.json` / `build.txt`, and `android-layout studio` shows the build. Protobuf/gRPC class names and inspector protos may differ across versions, so the helper no longer relies only on a prebuilt jar: on first use with a given Studio build, the helper is recompiled with that Studio's own JBR `javac`/`jar` against its `plugins/android/lib/*.jar`, and cached under `~/.cache/android-layout/helper/<key>/` keyed by `Studio build + helper source hash + compiler version`.
- **JDK version**: the Java selection order is `--java` → `AUI_JAVA` → `JAVA_HOME` → Studio JBR → `PATH`. An explicit `--java` or `AUI_JAVA` that does not exist is skipped with a warning (the run continues with the next candidate) rather than failing, so a stale override never blocks inspection silently. Helper compilation prefers the `javac`/`jar` in the **same directory as the runtime Java** to avoid class file version mismatches; without a compiler it falls back to the committed helper jar `helper/aui-compose-helper.jar`. Measured:
  - Studio JBR 25 → helper class 69, runs;
  - Microsoft OpenJDK 17 (via `--java`) → compiles class 61 with its own `javac`, runs.
- With other JBR/JDK builds:

  ```bash
  android-layout dump --source compose --java "C:/path/to/jdk/bin/java.exe"
  ```

  or provide a precompiled helper explicitly: `AUI_COMPOSE_HELPER_JAR=/path/to/helper.jar`.
- Compatibility boundary: if the Studio build is too old, missing artifacts such as `layout_inspector_compose_java_proto.jar`, or the Compose inspector proto lacks required messages, helper compilation fails with a hint; upgrade Studio, rebuild with `npm run build:helper` against a compatible Studio, or fall back to `source=semantics`. Currently tested: Android Studio `AI-262.10968.63.2622.16840690` (JBR 25).

## Compose JVMTI tree (Android Studio level)

```bash
android-layout dump --source compose --depth 10
android-layout find 推荐 --source compose
android-layout hit 540 2239 --source compose
android-layout analyze --source compose
android-layout dump --source compose --json --out ui.json
```

Prerequisites:

- The app is a debuggable build (`android:debuggable=true`);
- Android Studio installed locally (auto-detected by default; set `AUI_ANDROID_STUDIO` or `--studio` to point at one). Detection order: `--studio`/env var → **the running `studio64.exe`/`studio` process path** → common install paths. The Studio the developer is actually using wins (covers custom/Toolbox installs); `android-layout studio` shows the matched path and its source;
- Java 17+ (the Studio-bundled JBR is preferred; set `AUI_JAVA` or `--java` to override);
- The Compose inspector jar is downloaded and cached at version **1.8.3** under `~/.cache/android-layout/` by default; if the app's Compose version differs, set `AUI_COMPOSE_VERSION` or `AUI_COMPOSE_INSPECTOR_JAR`;
- API 29+ only (required by the Compose inspector), and the app must be in the foreground.

The implementation reuses the artifacts bundled with Android Studio:

- `plugins/android/resources/transport/<abi>/transport` (on-device gRPC transport daemon)
- `transport/native/agent/<abi>/libjvmtiagent.so` (JVMTI agent)
- `perfa.jar`, `layoutinspector-view-inspection.jar`
- `inspector.jar` from the Compose `ui-android` AAR
- Studio's `transport/app_inspection/view_layout_inspection/compose_layout_inspection` protos

The CLI pushes the daemon/agent, installs the inspector jar via `run-as`, attaches the agent, and drives the View inspector over gRPC (root view id only, screenshots disabled to avoid a 78MB SKP memory peak) plus the Compose inspector. The daemon stays resident in `/data/local/tmp/aui-compose` and is reused by later calls; `android-layout compose-clean` stops it and removes the on-device files.

Android Studio detection: explicit config → the running process's executable path → standard install paths. Process detection results are cached **for 1 hour** inside long-lived MCP processes; on Windows the first probe costs about 1.5–2s due to PowerShell startup, and later probes reuse the cache.

### Boundaries of the compose source

- You get: Composable names, package/file/line, layout/render bounds, parameters and text, recomposition/skip counts, merged/unmerged semantics flags;
- You do not get: the full Modifier chain order, custom Layout measurement internals, non-parameterized internal state;
- Text comes from Composable parameter extraction (`GetAllParameters`) and is not present on every node;
- Noticeably slower than view/semantics (8–12s); use it only when Compose structure / source location is needed.

### testTag and locator stability

`semantics` remains the **zero-config, zero-dependency** Compose option; by default it cannot see `testTag` as a resource-id unless an ancestor node enables the `testTagsAsResourceId` semantics:

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

Then `find --by id submit` can locate it (older Compose versions may need `@OptIn(ExperimentalComposeUiApi::class)`).
When locator stability matters, prefer `Modifier.semantics { contentDescription = "..." }` or `testTag` over text (text changes with locale and casing).

## Limitations

- `view` requires `android:debuggable=true`; release/non-debuggable builds can use `semantics` or `dumpsys` (structure and ids, no text).
- JDWP usually allows one debugger at a time; attach may fail while Android Studio is debugging.
- `compose` additionally requires a local Android Studio, Java 17+, the app in the foreground, and a matching Compose inspector jar; each capture takes about 8–12s and leaves a resident transport daemon on the device (`android-layout compose-clean` cleans it up).
- Without Android Studio, Compose is still available via `semantics` (zero dependencies; text/click semantics work).
- Content drawn straight to a `Canvas` (custom `View.onDraw`, `SurfaceView`, a `WebView`'s pixels) has no text or children in the `view` tree; the `semantics` tree only sees what the app exposes to accessibility, and the `compose` tree only sees composables (not canvas drawing).
- `view` text comes from framework text widgets; a custom view that draws its own labels exposes no text property.
- Some ROMs (e.g. MIUI) report an accessibility window shorter than the real screen through uiautomator, clipping bottom nodes; `analyze` skips touch-target measurement in that case, but `hit` still works (the center point stays inside the element).
- `input text` reliably supports ASCII only; Chinese input needs an extra IME (e.g. ADBKeyboard).
- No live monitoring; every command captures a fresh snapshot.
