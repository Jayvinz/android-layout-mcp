---
description: Verify an Android UI change on a real device with before/after dumps, diff, rules, and screenshot
argument-hint: [optional baseline path or description of the expected change]
---

# Verify UI change

Context: $ARGUMENTS

Follow the `verify-ui-change` skill.

## Step 0 — Android project gate

Confirm the working directory (or the repo root the user named) is an Android project: `settings.gradle(.kts)`, `gradlew(.bat)`, a module `build.gradle(.kts)` applying `com.android.*`, or `AndroidManifest.xml`.

If none:
- continue only when the user explicitly asked to inspect the device screen/page or explicitly mentioned Android;
- otherwise stop, say this plugin targets Android projects, and never scan the repository or call `locate_code`.

A connected device does not make the repository Android.

**HARD STOP:** if no Android marker exists and the user did not explicitly ask to inspect a connected device screen/page and did not explicitly mention Android, do NOT call `get_state`, `dump_ui`, `find_elements`, `locate_code`, or any other tool. Say the workspace is not an Android project; offer device observation or ask for the Android module path. A reference like "这个按钮/这个页面/这个弹窗" alone is not an explicit device request.

1. If a baseline dump path is given, use it. Otherwise, if the code has not been rebuilt/installed yet, capture one now with `dump_ui(source="auto", savePath=".dli/before.json", format="json")` and record `get_state`.
2. After the change is installed and the same page/scroll position is restored, capture `dump_ui(source="auto", savePath=".dli/after.json", format="json")`.
3. Run `diff_ui(beforePath=".dli/before.json", afterPath=".dli/after.json")` and `analyze_ui(source="auto")`.
4. Separate expected changes from regressions. Cite node refs/paths, bounds, and text.
5. If interaction changed, verify with `find_elements` then `tap`, followed by `get_state`.
6. If there is no baseline, say so explicitly; verify against the expected state plus `analyze_ui` and screenshot instead of inventing a before/after claim.
7. Report using the structure in the verify-ui-change skill. Do not edit code.
