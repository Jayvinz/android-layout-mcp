# Anchor Resolution: From UI Evidence to Source

This document maps each kind of evidence returned by the MCP server or locator script to Android source, and lists the edge cases that commonly cause misidentification.

## Compose (JVMTI)

| Evidence | Source location | Notes |
|---|---|---|
| `compose.name` | `@Composable fun Name(...)` | The name may come from an inlined composable; trust `file:line` over the name |
| `compose.fileName` + `lineNumber` | The nearest `@Composable` around the reported line | The reported location may be a definition or a call site; confirm by name, not the line number alone |
| Node `text` / `contentDescription` | `Text("...")`, `stringResource(R.string.x)`, `BasicText`, `AnnotatedString`, semantics modifiers | Text is extracted from Composable parameters and may be formatted or server-provided |
| `contentDescription` | `Modifier.semantics { contentDescription = ... }`, the `contentDescription` parameter | May be a `testTag` or a dynamic value |
| `bounds` | Modifier chain, parent layout, custom `Layout` measurement | Use only to confirm the hit; it does not map to a source line |
| `recomposeCount` / `flags` | `remember`, `derivedStateOf`, `@Stable`, `@Immutable` | Use for state/performance questions, not as locator anchors |

Resolution order:

1. With `file:line`, open the file directly and filter false positives by the `fun` definition.
2. With only a name, run `rg "fun <Name>\s*\("`; prefer occurrences near `@Composable`.
3. With only text, prefer string resources. If none exists, run `rg "<text>"` and narrow by module and call site.
4. Once the definition is found, run `rg "\b<Name>\s*\("` to find call sites and determine route/page ownership.

Common misidentifications:

- The same composable name exists in multiple modules (design system, feature).
- The literal in `Text("Me")` also appears in previews, tests, and samples.
- Text comes from `stringResource(R.string.x)`, so the Chinese literal is absent from source; follow the `R.string` resource.
- Text is assembled by `String.format`, `buildAnnotatedString`, or server fields; source may only contain the template.
- A `LazyColumn` item composable is a function, but the business logic lives in the item model / ViewModel.

## XML View

| Evidence | Source location | Notes |
|---|---|---|
| `resourceId` (`profile_tab`) | `android:id="@+id/profile_tab"` in `res/layout*/**.xml` | There may be several layout qualifier variants |
| Layout file | `setContentView(R.layout.x)`, `inflate(R.layout.x)`, Fragment `onCreateView`, Binding `inflate` | The entry is usually an Activity/Fragment/Adapter/Dialog |
| `<include layout="@layout/item">` | Parent layout → root layout chain | The script emits `layout-include-chain` |
| `android:onClick` | A method with the same name (`fun` / `void`) | The method may live in an Activity, Fragment, or `Context` extension |
| `binding.<camelId>` | ViewBinding property | `profile_tab` → `profileTab` |
| `android:text="@string/x"` | `strings.xml` + `R.string.x` in code | The text anchor may not be in the defining layout |
| Navigation XML `@+id/destination` | `NavHost`, `NavGraph`, `navigate(R.id.x)`, route strings | Compose Navigation may also use string routes |

Resolution order:

1. `rg '@\+id/<id>' --glob '*.xml'` to find the definition.
2. If the definition is in `item_*.xml`, find the Adapter/ViewHolder; if in `fragment_*.xml` / `activity_*.xml`, find the inflate site.
3. `rg 'R\.id\.<id>'` to find code references; prioritize `findViewById` and `setOnClickListener`.
4. `rg '\b<camelId>\b' --glob '*.kt' --glob '*.java'` to find ViewBinding usage; watch for false positives with identical local variable names.
5. When `<include>` is present, the parent chain reported by the script is the candidate entry; multiple `include` sites must be distinguished by module and the runtime page.
6. From the event function, find the `ViewModel` method name, `repository` call, and navigation target.

Common misidentifications:

- The same id appears in multiple layouts, modules, and flavors.
- `@id/foo` (a reference to an id defined elsewhere) is not a definition; a definition uses `@+id/foo`.
- DataBinding lambdas are placed differently from ViewBinding; check both `binding.foo.setOnClickListener` and `android:onClickListener`.
- Custom View business logic lives in `onDraw` / `onTouchEvent` / `onClick`, not in the layout.
- Ids under `ViewStub`, `merge`, or the `tools:` namespace are not runtime ids.

## Strings and Copy

Text anchors fall into four confidence levels, highest first:

1. A `string` resource name (`R.string.profile_title`) → definition plus all references.
2. `testTag` / `contentDescription` → usually stable anchors added specifically for automation.
3. XML `android:text` literals.
4. Kotlin/Java string literals.

Notes:

- `values-zh` / `values-en` have different values but the same resource name; unify by resource name first.
- `%1$s`, `{name}`, `<plurals>`, and `<string-array>` require template matching, not exact matching on the final text.
- Server-provided, CMS-managed, or A/B-tested copy does not exist in source. Follow the API field, data model, and display component; do not invent a resource name.
- `allCaps`, `textAllCaps`, and `uppercase()` change the on-device text; compare normalized text.

## Navigation / Page Ownership

| Form | Look for |
|---|---|
| Activity | `android:name` in `AndroidManifest.xml`, `setContentView` |
| Fragment | `NavHostFragment`, `<fragment android:name>`, `onCreateView` |
| Compose Navigation | `NavHost`, `composable("route")`, `navigate("route")` |
| ViewPager/Tab | `FragmentPagerAdapter`, `ViewPager2`, tab title/index |
| Dialog/BottomSheet | `DialogFragment`, `BottomSheetDialogFragment`, `show()` calls |
| Custom routing | The project's own Router/Navigator; search by route string or destination id |

Identify the **page entry** before the **element entry**. When the user asks about "the Me button on the current page", page ownership and button behavior matter equally.

## Multi-module / Multi-flavor / Large Repositories

- Same-named resources are merged; the one that takes effect depends on the current `applicationId` + flavor + buildType.
- Search the current module first (the includes in `settings.gradle`, `:app` dependencies) and the current `sourceSets`.
- `src/main`, `src/debug`, `src/release`, and `src/<flavor>` may all override the same file.
- Generated code (Hilt, Room, Navigation Safe Args, DataBinding) is not hand-written source; find what generates it.
- UI inside third-party AARs or vendored modules is not this repository's business code; state that in the conclusion.

## Confidence Labels

- **High**: has `file:line`, code has been read, and the anchor is unique.
- **Medium**: has a resource/id/Compose name, but a duplicate exists or the entry is not fully confirmed.
- **Low**: text-only match, or only semantics evidence; must be stated explicitly in the output.
