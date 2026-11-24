---
description: Verify an Android UI change on a real device with before/after dumps, diff, rules, and screenshot
argument-hint: [optional baseline path or description of the expected change]
---

# Verify UI change

Context: $ARGUMENTS

Follow the `verify-ui-change` skill.

## Step 0 — Android project gate

Apply the gate from the `verify-ui-change` skill: `settings.gradle(.kts)`, `gradlew(.bat)`, a module `build.gradle(.kts)` applying `com.android.*`, or `AndroidManifest.xml`. A connected device does not make the repository Android.

**HARD STOP:** with no marker, and no explicit device/screen request or Android mention, call no tool. Say the workspace is not an Android project and ask for the Android module path. "这个按钮/这个页面/这个弹窗" alone is not an explicit device request.

Run the `verify-ui-change` workflow: baseline `dump_ui(..., savePath=".aui/before.json", format="json")` → after the change `dump_ui(..., savePath=".aui/after.json")` → `diff_ui` + `analyze_ui`.

Command-specific notes:

- If `$ARGUMENTS` gives a baseline path, use it instead of capturing one.
- Without a baseline, say so and verify against the expected state rather than inventing a before/after claim.
- Cite node refs/paths, bounds, and text when separating expected changes from regressions; do not edit code.
