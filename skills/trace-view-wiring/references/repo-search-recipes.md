# Repository Search Recipes

Prefer running `locate-code.mjs` to generate candidates, then verify with `rg`. Do not have the agent blindly walk the repository from its root.

## Common exclusions

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

`rg` respects `.gitignore` by default. Do not add `--no-ignore` casually, or build artifacts and caches will pollute the candidates.

## XML ids

Definition:

```bash
rg '@\+id/profile_tab' --glob '*.xml'
```

References (excluding the definition):

```bash
rg 'R\.id\.profile_tab' --glob '*.kt' --glob '*.java'
rg '\bprofileTab\b' --glob '*.kt' --glob '*.java'
```

Layout entry:

```bash
rg 'R\.layout\.(fragment|activity)_profile' --glob '*.kt' --glob '*.java'
rg 'setContentView|\.inflate\(' --glob '*.kt' --glob '*.java'
```

`<include>`:

```bash
rg '<include[^>]*layout="@layout/(item|fragment)_profile"' --glob '*.xml'
```

`android:onClick`:

```bash
rg 'android:onClick=' --glob '*.xml'
# Replace openProfile with the method name used by onClick in the layout
rg 'fun openProfile\s*\(|void openProfile\s*\(' --glob '*.kt' --glob '*.java'
```

## String resources

```bash
rg 'name="profile_title"' --glob '**/res/values*/strings.xml'
rg 'R\.string\.profile_title' --glob '*.kt' --glob '*.java'
rg 'stringResource\(.*R\.string\.profile_title' --glob '*.kt'
rg 'android:text="@string/profile_title"' --glob '*.xml'
```

Localization/plurals:

```bash
rg '<plurals|<string-array' --glob '**/res/values*/strings.xml'
```

## Compose

Definition:

```bash
rg -n '@Composable' --glob '*.kt' -A 3 | rg 'fun ProfileTab'
rg -n 'fun ProfileTab\s*\(' --glob '*.kt'
```

Call sites:

```bash
rg -n '\bProfileTab\s*\(' --glob '*.kt'
```

Strings/state:

```bash
rg 'stringResource\(R\.string\.profile_title\)' --glob '*.kt'
rg 'collectAsState|collectAsStateWithLifecycle|LaunchedEffect|remember' --glob '*.kt' -n
```

Navigation:

```bash
rg 'NavHost|composable\("' --glob '*.kt' -n
rg 'navigate\(' --glob '*.kt' -n
```

## Page entry points

```bash
rg 'class .*Activity' --glob '*.kt' --glob '*.java'
rg 'class .*Fragment' --glob '*.kt' --glob '*.java'
rg 'setContentView|onCreateView|ViewBinding|Binding\.inflate' --glob '*.kt' --glob '*.java'
rg '<activity|<fragment' --glob '**/AndroidManifest.xml'
```

Navigation XML:

```bash
rg '@\+id/profile' --glob '**/res/navigation/*.xml'
rg 'android:name=".*Profile' --glob '*.xml'
```

## Multi-module / flavor resolution

1. Read the include list in `settings.gradle(.kts)` to determine which modules belong to the current product.
2. Then inspect `productFlavors`, `sourceSets`, and `dependencies` in `app/build.gradle(.kts)`.
3. When a candidate path contains `src/<flavor>/` or `src/<buildType>/`, confirm the active build variant.
4. When the same file exists in several modules, order by dependency direction (`:app` → `:feature:profile` → `:core:designsystem`).
5. `build/`, `generated/`, `ksp/`, `kapt/`, and `safeArgs` outputs are not hand-written source; find the annotation or contract that generates them.

## Candidate verification checklist

For each candidate, open the file and confirm:

- [ ] The line context really is that element/string/layout, not a same-named variable or comment.
- [ ] The defining module is active in the current build variant.
- [ ] The event handler is actually triggered by this element (check the listener or `android:onClick`).
- [ ] The Compose definition really renders that `Text`/`contentDescription` (not a same-named preview with different arguments).
- [ ] With localization, the resource names match and only qualifiers differ.
- [ ] An `@id/foo` reference was not mistaken for an `@+id/foo` definition.
- [ ] Generated code or third-party libraries were not treated as this repository's business logic.

## When there are no candidates

Try in order:

1. Use nearby static text ("Settings", "Messages") instead of dynamic copy.
2. Use `resourceId` or `contentDescription`.
3. Add `--include-tests`; tests often contain `testTag` values and fixed copy.
4. Widen `--root` to the monorepo root or a directory that contains the `feature` modules.
5. Check resources outside `values-*/strings.xml` (`assets/`, JSON, remote config, CMS).
6. If there is still nothing, conclude "no static anchor found in source" and list possible data sources. Do not invent one.
