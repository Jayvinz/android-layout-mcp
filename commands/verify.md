---
description: Verify an Android UI change on a real device with before/after dumps, diff, rules, and screenshot
argument-hint: [optional baseline path or description of the expected change]
---

# Verify UI change

Context: $ARGUMENTS

Follow the `verify-ui-change` skill.

1. If a baseline dump path is given, use it. Otherwise, if the code has not been rebuilt/installed yet, capture one now with `dump_ui(source="auto", savePath=".dli/before.json", format="json")` and record `get_state`.
2. After the change is installed and the same page/scroll position is restored, capture `dump_ui(source="auto", savePath=".dli/after.json", format="json")`.
3. Run `diff_ui(beforePath=".dli/before.json", afterPath=".dli/after.json")` and `analyze_ui(source="auto")`.
4. Separate expected changes from regressions. Cite node refs/paths, bounds, and text.
5. If interaction changed, verify with `find_elements` then `tap`, followed by `get_state`.
6. If there is no baseline, say so explicitly; verify against the expected state plus `analyze_ui` and screenshot instead of inventing a before/after claim.
7. Report using the structure in the verify-ui-change skill. Do not edit code.
