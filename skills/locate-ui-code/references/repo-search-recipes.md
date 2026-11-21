# 大仓库搜索配方

优先使用 `locate-code.mjs` 生成候选，再用 `rg` 验证。不要让 agent 从仓库根目录盲目遍历。

## 通用排除

```bash
rg <pattern> \
  --glob '!**/build/**' \
  --glob '!**/.gradle/**' \
  --glob '!**/generated/**' \
  --glob '!**/intermediates/**' \
  --glob '!**/.cxx/**' \
  --glob '!**/node_modules/**' \
  --glob '!**/test/**' \
  --glob '!**/androidTest/**'
```

`rg` 默认遵守 `.gitignore`；不要随意 `--no-ignore`，否则会把构建产物和缓存算进候选。

## XML id

定义：

```bash
rg '@\+id/profile_tab' --glob '*.xml'
```

引用（排除定义）：

```bash
rg 'R\.id\.profile_tab' --glob '*.kt' --glob '*.java'
rg '\bprofileTab\b' --glob '*.kt' --glob '*.java'
```

布局入口：

```bash
rg 'R\.layout\.(fragment|activity)_profile' --glob '*.kt' --glob '*.java'
rg 'setContentView|\.inflate\(' --glob '*.kt' --glob '*.java'
```

`<include>`：

```bash
rg '<include[^>]*layout="@layout/(item|fragment)_profile"' --glob '*.xml'
```

`android:onClick`：

```bash
rg 'android:onClick=' --glob '*.xml'
# 把 openProfile 替换为布局里 onClick 的方法名
rg 'fun openProfile\s*\(|void openProfile\s*\(' --glob '*.kt' --glob '*.java'
```

## 字符串资源

```bash
rg 'name="profile_title"' --glob '**/res/values*/strings.xml'
rg 'R\.string\.profile_title' --glob '*.kt' --glob '*.java'
rg 'stringResource\(.*R\.string\.profile_title' --glob '*.kt'
rg 'android:text="@string/profile_title"' --glob '*.xml'
```

多语言/复数：

```bash
rg '<plurals|<string-array' --glob '**/res/values*/strings.xml'
```

## Compose

定义：

```bash
rg -n '@Composable' --glob '*.kt' -A 3 | rg 'fun ProfileTab'
rg -n 'fun ProfileTab\s*\(' --glob '*.kt'
```

调用点：

```bash
rg -n '\bProfileTab\s*\(' --glob '*.kt'
```

字符串/状态：

```bash
rg 'stringResource\(R\.string\.profile_title\)' --glob '*.kt'
rg 'collectAsState|collectAsStateWithLifecycle|LaunchedEffect|remember' --glob '*.kt' -n
```

导航：

```bash
rg 'NavHost|composable\("' --glob '*.kt' -n
rg 'navigate\(' --glob '*.kt' -n
```

## 页面入口

```bash
rg 'class .*Activity' --glob '*.kt' --glob '*.java'
rg 'class .*Fragment' --glob '*.kt' --glob '*.java'
rg 'setContentView|onCreateView|ViewBinding|Binding\.inflate' --glob '*.kt' --glob '*.java'
rg '<activity|<fragment' --glob '**/AndroidManifest.xml'
```

Navigation XML：

```bash
rg '@\+id/profile' --glob '**/res/navigation/*.xml'
rg 'android:name=".*Profile' --glob '*.xml'
```

## 多 module / flavor 定位

1. 先看 `settings.gradle(.kts)` 的 include 列表，确定哪些模块属于当前产品。
2. 再看 `app/build.gradle(.kts)` 的 `productFlavors`、`sourceSets`、`dependencies`。
3. 候选文件路径里带 `src/<flavor>/` 或 `src/<buildType>/` 时，确认当前构建变体。
4. 同名文件出现在多个模块时，按依赖方向（`:app` → `:feature:profile` → `:core:designsystem`）排序。
5. `build/`、`generated/`、`ksp/`、`kapt/`、`safeArgs` 输出不是手写源码；找触发它们的注解/协议。

## 候选验证清单

对每个候选，打开文件确认：

- [ ] 行号上下文确实是该控件/字符串/布局，而不是同名变量或注释。
- [ ] 定义所在模块在当前构建变体中生效。
- [ ] 事件处理函数确实由该控件触发（检查 listener 或 `android:onClick`）。
- [ ] Compose 定义确实渲染了该 `Text`/`contentDescription`（而不是同名但不同参数的预览）。
- [ ] 若有多语言，资源名一致，值只是限定符不同。
- [ ] 没有把 `@id/foo` 引用误当 `@+id/foo` 定义。
- [ ] 没有把生成代码或第三方库当成本仓库业务。

## 没有候选时

按顺序尝试：

1. 用邻近静态文本（“设置”“消息”）代替动态文案。
2. 用 `resourceId` 或 `contentDescription`。
3. 加 `--include-tests`，测试里常有 `testTag` 和固定文案。
4. 扩大 `--root` 到 monorepo 根或包含 `feature` 模块的目录。
5. 检查 `values-*/strings.xml` 之外的资源（`assets/`、JSON、远端配置、CMS）。
6. 如果仍然没有，结论写“源码中未找到静态锚点”，并给出可能的数据来源，不要编造。
