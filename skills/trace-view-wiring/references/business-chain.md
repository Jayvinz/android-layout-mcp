# From Element to Business Chain

"Related code logic" is rarely a single `onClick` line. Follow the order below so you do not stop at the UI layer.

## 1. Confirm the element is the entry point

- `Button`, `IconButton`, `FloatingActionButton`, `ListItem`, `Tab`, `MenuItem`, and `Switch` are usually entry points.
- `Text`, `Icon`, `Image`, and containers are usually display-only; in Compose, however, any node may carry `Modifier.clickable`.
- The click may be handled by a **parent** (`clickable` on `Row`/`Card`/`ListItem`) while the child only provides content. Check the hit node's parent chain first.
- `enabled`, `visible`, `alpha`, and `clickable` may be controlled by external state that is not visible in the UI layer.

## 2. Compose chain

Read in this order:

1. The Composable's `onClick` / `onValueChange` / `onAction` parameters.
2. The parent that calls this Composable, and the lambda it passes in.
3. Inside the lambda: `viewModel::method`, `navigate(...)`, or `onEvent(UiEvent.X)`.
4. The ViewModel method: updates `MutableStateFlow`, emits events, calls a UseCase/Repository.
5. UI state: `uiState.collectAsStateWithLifecycle()`, `StateFlow`, `remember`, `derivedStateOf`.
6. Conditional branches: `if (uiState.isLoggedIn)`, `enabled = ...`, `visible = ...`, experiment flags.

Typical structure:

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

Notes:

- `viewModel::openProfile` is a method reference. The event is emitted in the ViewModel but may be consumed by a `LaunchedEffect` in the Route.
- Design-system components (`AppButton`) may wrap `onClick` again; follow through to the final `Button`'s `onClick` instead of stopping at the design system.
- `Modifier.clickable` lives in a modifier chain and may be defined in a separate function; inspect the order in which the `Modifier` is built.
- Compose `Text` may receive an `AnnotatedString`, so the text anchor does not necessarily map to a source literal.

## 3. XML chain

1. The layout's `android:id`.
2. The inflate site: Activity `setContentView` / Fragment `onCreateView` / Adapter `onCreateViewHolder` / Dialog.
3. The binding mechanism: `findViewById`, ViewBinding, DataBinding, `android:onClick`.
4. Listeners: `setOnClickListener`, `setOnCheckedChangeListener`, `setOnItemClickListener`.
5. Handler: direct business logic, ViewModel method, UseCase, Repository.
6. List items: logic usually lives in the Adapter/ViewHolder/item model, not in the item layout.

Typical structure:

```kotlin
binding.profileEntry.setOnClickListener { viewModel.openProfile() }
```

```xml
<Button android:id="@+id/profile_entry"
        android:onClick="openProfile" />
```

Notes:

- DataBinding lambdas and `@{}` expressions follow a different path from plain ViewBinding.
- The `android:onClick` method may live in an Activity/Fragment/Context extension; its signature must be `public void method(View)`.
- An `AndroidView` embedded in Compose still follows the XML View path.
- `ViewStub` inflates at runtime, so a static search may only find the stub definition; keep looking for the `inflate()` call.

## 4. State and data sources

Ordered by likelihood:

1. ViewModel: `StateFlow` / `LiveData` / `MutableState`.
2. UseCase / Interactor: business rules, permissions, experiment flags.
3. Repository / DataSource: network, database, cache.
4. Global state: SessionManager, AppConfig, FeatureFlag, A/B experiments.
5. Server fields: API DTOs, CMS configuration, copy fields.

Follow only as far as the question requires. For example, if the user asks "why is this button grayed out", follow the state source of `enabled` and stop; do not expand the entire network layer.

## 5. Conditions, side effects, and analytics

Check first:

- Login/permissions: `isLoggedIn`, `checkPermission`, `requireLogin`.
- Feature flags: `FeatureFlag`, `remoteConfig`, `experiment`.
- Empty/loading states: `Loading`, `Empty`, `Error`.
- Analytics: `track`, `analytics`, `logEvent` (usually a post-click side effect).
- Navigation: `navigate`, `startActivity`, `NavController`.
- Refresh: `refresh()`, `invalidate()`, cache invalidation.

## 6. When to stop

- The user only asks "where is it": entry + event handler, 1–2 hops.
- The user asks for "related logic": entry + event + state source + key conditions, 2–4 hops.
- The user asks "why": follow the condition chain that produces the current behavior and provide evidence.
- At a module boundary: confirm the module and dependency direction before going deeper.

## 7. Common misidentifications

- The `onClick` only calls `navigate`; the business logic is on the destination page, not this one.
- The `onClick` only calls `track`; the real handling is in another callback.
- The `Text` value comes from a caller parameter; the actual copy lives higher up.
- Methods/Composables with the same name exist in multiple modules; distinguish by module dependencies and call sites.
- Tests, previews, and samples contain the same text or function names. Tests are excluded by default; previews require manual judgment.
- Generated code (Hilt/Room/Nav Safe Args/DataBinding) is not the business source.
