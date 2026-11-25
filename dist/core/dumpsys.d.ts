import type { ScreenInfo, UiNode } from "./model.js";
/**
 * Fragment record parsed from `dumpsys activity <pkg>`.
 *
 * The dump lists fragment instances per hosting Activity: tag, short class,
 * lifecycle state, and whether it is added/hidden/detached. `containerId` is
 * usually `#0`, so a fragment cannot be mapped to a view subtree by id; use the
 * tag and the hosting Activity instead.
 */
export interface FragmentInfo {
    /** Instance discriminator as printed, e.g. "c0{ed452da #0 tag}". */
    raw: string;
    /** Fragment class as printed; obfuscated in release builds. */
    className: string | null;
    shortClassName: string | null;
    tag: string | null;
    /** Lifecycle state: 0=ATTACHED … 5=RESUMED. */
    state: number | null;
    fragmentId: number | null;
    containerId: number | null;
    added: boolean;
    hidden: boolean;
    detached: boolean;
    /** Nesting depth in the FragmentManager back stack. */
    backStackNesting: number | null;
    /** Hosting Activity at the time of the dump. */
    activity: string | null;
}
export interface DumpsysActivity {
    /** Fully qualified activity name as printed, e.g. `pkg/.MainActivity`. */
    activity: string;
    packageName: string;
    pid: number | null;
    /** Fragments registered under this activity, framework ones included. */
    fragments: FragmentInfo[];
    roots: UiNode[];
}
export interface DumpsysParseResult {
    activities: DumpsysActivity[];
    /** Fragments of the activity whose view hierarchy was chosen. */
    fragments: FragmentInfo[];
    roots: UiNode[];
    /** Activity the chosen hierarchy came from. */
    activity: string | null;
}
/**
 * Parses `adb shell dumpsys activity <package>` (or `activity top`) output.
 *
 * Two independent sections matter:
 *  - `View Hierarchy:` — an indentation-based tree of `Class{hash flags l,t-r,b #resId name}`.
 *  - `Active Fragments in <hash>:` / `Added Fragments:` — fragment records.
 *
 * The hierarchy carries class names, resource ids, and absolute bounds but no
 * text; the semantics tree carries text but no ids. Use both together.
 */
export declare function parseDumpsys(output: string, options?: {
    packageName?: string | null;
    screen?: ScreenInfo;
    /** Prefer the activity containing this name; otherwise the first with a tree. */
    activityHint?: string | null;
}): DumpsysParseResult;
/** Fragments across every activity in the dump, de-duplicated by activity+raw. */
export declare function allFragments(result: DumpsysParseResult): FragmentInfo[];
/**
 * Fragments that are not framework bookkeeping. AndroidX injects a
 * `ReportFragment` per host for lifecycle dispatch; those carry no product
 * meaning and only add noise to a report.
 */
export declare function notableFragments(fragments: FragmentInfo[]): FragmentInfo[];
/**
 * Fills `text`/`contentDescription` on dumpsys nodes by matching geometry
 * against a semantics tree.
 *
 * Neither source is sufficient alone on a non-debuggable app: dumpsys has the
 * real View classes and resource ids but no text, while the semantics tree has
 * the text but reports accessibility classes. A match requires an identical
 * visible rect and a compatible class, so a coarse fit cannot silently attach
 * the wrong label.
 */
export declare function mergeSemanticsText(dumpsysRoots: UiNode[], semanticsRoots: UiNode[], options?: {
    screen?: ScreenInfo;
}): {
    matched: number;
    labelled: number;
    verticalOffset: number;
};
