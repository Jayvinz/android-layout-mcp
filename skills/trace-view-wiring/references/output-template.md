# Location Report Template

Goal: another engineer should be able to verify the conclusion within 30 seconds and know where to read next. Do not paste entire files. Write the report in the user's language; this template uses English headings and placeholder text.

## Template

```markdown
## Conclusion
<Control> is rendered by `<entry type> <name>`, defined at `<file>:<line>`.
Clicking it invokes `<handler>` (`<file>:<line>`); state comes from `<ViewModel/Repository>`.

## UI evidence
- Device/package/page: <serial> / <applicationId> / <Activity or route>
- uiKind: compose | xml | mixed
- Hit node: `<ref>` `<className>` "<text>" id=`<resourceId>` bounds=`[l,t][r,b]` clickable=<bool>
- Capture time: <ISO time> (refs are invalid after the UI changes)

## Code anchors
- String: `<R.string.name>` → `strings.xml:<line>`
- Layout/Compose: `<file>:<line>`
- Event/binding: `<file>:<line>`

## Call chain
1. `<file>:<line>` — `<description>` (confirmed)
2. `<file>:<line>` — `<description>` (confirmed)
3. `<file>:<line>` — `<description>` (inferred: from naming/navigation)

## Related logic
- Visibility/click conditions: <login, permissions, experiment flags, empty state>
- State source: <StateFlow / LiveData / Repository / local cache>
- Side effects: <analytics, navigation, refresh>

## Uncertainties
- <multiple flavors, dynamic copy, server-driven content, missing callers>

## Next steps
- Read first: `<file>:<line>`
- Suggested change: `<file>` (no code was modified)
- Verify: MCP `dump_ui(savePath=".aui/before.json")` → after the change `dump_ui(savePath=".aui/after.json")` → compare those two files yourself;
  or `mkdir -p .aui && node "$AUI_ROOT/dist/cli.js" dump --json --out .aui/after.json`;
  then use MCP `analyze_ui` to check touch targets, clipping, and overlap.
```

## Example (Compose)

```markdown
## Conclusion
The "Me" entry is rendered by `ProfileTab`, defined at
`feature/profile/src/main/java/.../ProfileScreen.kt:120`.
Clicking it calls `ProfileViewModel.openProfile()`; state comes from `ProfileUiState`.

## UI evidence
- Package: com.example.app / MainActivity
- uiKind: compose
- Hit: c42 Text "Me" bounds=[932,2100][1048,2200] clickable=true
- Compose: ProfileTab ProfileScreen.kt:120

## Code anchors
- R.string.profile_tab → app/src/main/res/values-zh/strings.xml:88
- ProfileTab → feature/profile/.../ProfileScreen.kt:120
- Call site → feature/profile/.../ProfileRoute.kt:64

## Call chain
1. ProfileScreen.kt:120 — `Text(stringResource(R.string.profile_tab))` (confirmed)
2. ProfileScreen.kt:126 — `Modifier.clickable { onProfileClick() }` (confirmed)
3. ProfileRoute.kt:64 — `onProfileClick = viewModel::openProfile` (confirmed)
4. ProfileViewModel.kt:71 — `openProfile()` emits `NavigateToProfile` (confirmed)

## Uncertainties
- If `src/debug` contains a same-named `ProfileScreen.kt`, the active build variant decides.
```

## Locate only, no logic trace

When the user only asks "where is this button", stop at the entry + event handler:

```markdown
The "Me" button → `ProfileScreen.kt:120` (Composable `ProfileTab`);
the click handler is at `ProfileScreen.kt:126` → `ProfileViewModel.openProfile()`.
Should I continue into the state/API chain?
```

## Do not

- Paste code blocks longer than 20 lines.
- Present a candidate score as a conclusion.
- Omit the confidence note when there is no `file:line`.
- Modify code during a location task.
