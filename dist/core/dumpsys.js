import { assignRefs, flattenNodes, simpleClassName } from "./viewdump.js";
import { normalizeResourceId } from "./viewdump.js";
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
export function parseDumpsys(output, options = {}) {
    const lines = output.split(/\r?\n/).map(toRawLine);
    const activities = parseActivities(lines, options.packageName ?? null, options.screen);
    const chosen = activities.find((entry) => options.activityHint && entry.activity.includes(options.activityHint)) ??
        activities.find((entry) => entry.roots.length > 0) ??
        activities[0] ??
        null;
    if (chosen)
        assignRefs(chosen.roots, "d");
    return {
        activities,
        fragments: chosen?.fragments ?? [],
        roots: chosen?.roots ?? [],
        activity: chosen?.activity ?? null,
    };
}
/** Fragments across every activity in the dump, de-duplicated by activity+raw. */
export function allFragments(result) {
    const seen = new Set();
    const out = [];
    for (const activity of result.activities) {
        for (const fragment of activity.fragments) {
            const key = `${activity.activity}|${fragment.raw}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            out.push(fragment);
        }
    }
    return out;
}
/**
 * Fragments that are not framework bookkeeping. AndroidX injects a
 * `ReportFragment` per host for lifecycle dispatch; those carry no product
 * meaning and only add noise to a report.
 */
export function notableFragments(fragments) {
    return fragments.filter((fragment) => {
        const name = fragment.className ?? fragment.tag ?? "";
        if (/ReportFragment/.test(name))
            return false;
        if (/LifecycleDispatcher\.report_fragment_tag/.test(fragment.tag ?? ""))
            return false;
        if (/ConfigurationChangeFragment/.test(name))
            return false;
        return true;
    });
}
function toRawLine(line) {
    const match = /^(\s*)(.*)$/.exec(line);
    return { indent: match ? match[1].length : 0, text: match ? match[2] : line };
}
function parseActivities(lines, packageName, screen) {
    const activities = [];
    let current = null;
    // Section state inside one activity block.
    let mode = "none";
    let hierarchyIndent = -1;
    let stack = [];
    let pendingFragment = null;
    for (const line of lines) {
        const { indent, text } = line;
        if (text.trim() === "")
            continue;
        const activityMatch = /^\s*ACTIVITY (\S+) (\S+)(?: pid=(\d+))?/.exec(text);
        if (activityMatch) {
            const qualified = activityMatch[1];
            current = {
                activity: qualified,
                packageName: qualified.split("/")[0] ?? packageName ?? "",
                pid: activityMatch[3] ? Number.parseInt(activityMatch[3], 10) : null,
                fragments: [],
                roots: [],
            };
            activities.push(current);
            mode = "none";
            pendingFragment = null;
            continue;
        }
        if (!current)
            continue;
        if (/View Hierarchy:\s*$/.test(text)) {
            mode = "hierarchy";
            hierarchyIndent = -1;
            stack = [];
            continue;
        }
        if (/Active Fragments in\b/.test(text)) {
            mode = "fragments-active";
            pendingFragment = null;
            continue;
        }
        if (/Added Fragments:\s*$/.test(text)) {
            mode = "fragments-added";
            pendingFragment = null;
            continue;
        }
        // Leaving the fragment blocks when a new labelled section starts.
        if (mode === "fragments-active" || mode === "fragments-added") {
            if (/^[A-Z].*:\s*$/.test(text) || /^m[A-Z]\w*=/.test(text.trim())) {
                if (!/^mFragment/.test(text.trim()) && !/^m[A-Z]\w*=/.test(text.trim())) {
                    mode = "none";
                }
            }
        }
        if (mode === "hierarchy") {
            const view = parseViewLine(text, screen);
            if (!view) {
                // The hierarchy block ends at the first non-view line.
                if (stack.length > 0 || current.roots.length > 0)
                    mode = "none";
                continue;
            }
            if (hierarchyIndent < 0)
                hierarchyIndent = indent;
            const node = viewNode(view, indent - hierarchyIndent);
            // Find the nearest shallower ancestor.
            while (stack.length > 0 && stack[stack.length - 1].indent >= indent)
                stack.pop();
            const parent = stack[stack.length - 1]?.node;
            if (parent) {
                parent.children.push(node);
                node.parent = parent;
            }
            else {
                current.roots.push(node);
            }
            stack.push({ node, indent });
            continue;
        }
        if (mode === "fragments-active" || mode === "fragments-added") {
            const fragmentHead = /^#(\d+):\s+(\S+?)\{(\w+)\s+#(\d+)(?:\s+([^}]*))?\}/.exec(text);
            if (fragmentHead) {
                // The head regex already stripped the `{`, so group 2 is the class itself.
                const className = /^[A-Za-z0-9_.$]+$/.test(fragmentHead[2]) ? fragmentHead[2] : null;
                pendingFragment = {
                    raw: text.trim(),
                    className,
                    shortClassName: className ? simpleClassName(className) : null,
                    tag: fragmentHead[5]?.trim() || null,
                    state: null,
                    fragmentId: null,
                    containerId: null,
                    added: false,
                    hidden: false,
                    detached: false,
                    backStackNesting: null,
                    activity: current.activity,
                };
                current.fragments.push(pendingFragment);
                continue;
            }
            if (pendingFragment && /^m[A-Z]\w*=/.test(text.trim())) {
                const trimmed = text.trim();
                const state = /^mState=(\d+)/.exec(trimmed);
                if (state)
                    pendingFragment.state = Number.parseInt(state[1], 10);
                const fragmentId = /^mFragmentId=#(\d+)/.exec(trimmed);
                if (fragmentId)
                    pendingFragment.fragmentId = Number.parseInt(fragmentId[1], 10);
                const containerId = /^mContainerId=#(\d+)/.exec(trimmed);
                if (containerId)
                    pendingFragment.containerId = Number.parseInt(containerId[1], 10);
                const added = /^mAdded=(true|false)/.exec(trimmed);
                if (added)
                    pendingFragment.added = added[1] === "true";
                const hidden = /^mHidden=(true|false)/.exec(trimmed);
                if (hidden)
                    pendingFragment.hidden = hidden[1] === "true";
                const detached = /^mDetached=(true|false)/.exec(trimmed);
                if (detached)
                    pendingFragment.detached = detached[1] === "true";
                const nesting = /^mBackStackNesting=(\d+)/.exec(trimmed);
                if (nesting)
                    pendingFragment.backStackNesting = Number.parseInt(nesting[1], 10);
            }
        }
    }
    return activities;
}
/**
 * One hierarchy line, in the shapes `dumpsys` actually prints:
 *
 *   android.widget.FrameLayout{1189760 V.E...... .......D 0,0-1080,2400}
 *   android.widget.TextView{fbf1d8d V.ED..... ........ 0,0-733,58 #7f0b0b3b app:id/title}
 *   DecorView@4d1af3d[SystemAppPermissionDialogActivity]
 *
 * The root `DecorView@hash[title]` form has no bounds; it inherits the screen.
 */
function parseViewLine(text, screen) {
    const decor = /^([A-Za-z0-9_.$]+)@([0-9a-f]+)\[(.*)\]$/.exec(text);
    if (decor) {
        // The DecorView line has no bounds of its own; the window fills the screen.
        const width = screen?.width ?? 0;
        const height = screen?.height ?? 0;
        return {
            className: normalizeDecorClass(decor[1]),
            hash: decor[2],
            flags: "V.E",
            layoutFlags: "",
            bounds: { left: 0, top: 0, right: width, bottom: height, width, height },
            resourceId: null,
        };
    }
    // Inside the braces: `<hash> <flags> <layout-flags> <l,t-r,b> [#resId name]`.
    // The two flag groups are both kept; a class "V.E...... ........" means
    // visible+enabled with no layout flags, not a single 18-character group.
    const match = /^([A-Za-z0-9_.$]+)\{([0-9a-f]+)\s+(\S+)\s+(\S+)\s+(-?\d+,-?\d+--?\d+,-?\d+)(?:\s+(.*))?\}$/.exec(text.trim());
    if (!match)
        return null;
    const bounds = parseBounds(match[5]);
    if (!bounds)
        return null;
    const tail = match[6] ?? "";
    const idMatch = /#(?:[0-9a-f]+|[0-9]+)\s+([A-Za-z0-9_.]+:id\/[A-Za-z0-9_]+)/.exec(tail);
    return {
        className: match[1],
        hash: match[2],
        flags: match[3],
        layoutFlags: match[4],
        bounds,
        resourceId: idMatch ? normalizeResourceId(idMatch[1]) : null,
    };
}
function normalizeDecorClass(name) {
    // `DecorView` alone loses the package prefix that other classes carry.
    if (!name.includes("."))
        return "com.android.internal.policy.DecorView";
    return name;
}
function parseBounds(value) {
    const match = /^(-?\d+),(-?\d+)-(-?\d+),(-?\d+)$/.exec(value);
    if (!match)
        return null;
    const left = Number.parseInt(match[1], 10);
    const top = Number.parseInt(match[2], 10);
    const right = Number.parseInt(match[3], 10);
    const bottom = Number.parseInt(match[4], 10);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
}
/**
 * View flag string, one character per position (see View.toString output):
 *   0 visibility   V/I/G
 *   1 FOCUSED
 *   2 ENABLED
 *   3 WILL_NOT_DRAW
 *   6 CLICKABLE
 *   7 LONG_CLICKABLE
 *   9 CHECKABLE
 *  10 CHECKED
 *  14 SELECTED
 * A dot means "flag not set", so `V.E......` is visible + enabled + nothing else.
 */
function viewNode(view, depth) {
    const flags = view.flags;
    const visibility = flags[0] ?? "V";
    const focused = flags[1] === "F";
    const enabled = flags[2] === "E";
    const clickable = flags[6] === "C";
    const longClickable = flags[7] === "L";
    const checkable = flags[9] === "K";
    const checked = flags[10] === "K";
    const selected = flags[14] === "S";
    const { bounds } = view;
    const visible = visibility === "V" && bounds.width > 0 && bounds.height > 0;
    const node = {
        id: "",
        ref: "",
        source: "dumpsys",
        index: 0,
        depth,
        className: view.className,
        shortClassName: simpleClassName(view.className),
        packageName: null,
        resourceId: view.resourceId,
        text: null,
        contentDescription: null,
        bounds,
        visibleBounds: visible ? bounds : null,
        center: {
            x: bounds.width ? bounds.left + bounds.width / 2 : 0,
            y: bounds.height ? bounds.top + bounds.height / 2 : 0,
        },
        visible,
        enabled,
        clickable,
        longClickable,
        focusable: false,
        focused,
        scrollable: /ScrollView|RecyclerView|ViewPager|NestedScroll|ListView|GridView/.test(view.className),
        checkable,
        checked,
        selected,
        password: false,
        children: [],
        attributes: { dumpsysFlags: view.flags, ...(view.hash ? { hash: view.hash } : {}) },
        parent: null,
    };
    return node;
}
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
export function mergeSemanticsText(dumpsysRoots, semanticsRoots, options = {}) {
    const semantics = flattenNodes(semanticsRoots).filter((node) => node.text || node.contentDescription);
    // dumpsys reports window coordinates; uiautomator reports screen coordinates.
    // The gap is the status bar, so measure it from the two roots instead of
    // hard-coding a status bar height.
    const verticalOffset = measureVerticalOffset(dumpsysRoots, semanticsRoots, options.screen);
    const byRect = new Map();
    const key = (bounds) => `${bounds.left},${bounds.top},${bounds.right},${bounds.bottom}`;
    for (const node of semantics) {
        const rect = key(node.visibleBounds ?? node.bounds);
        const bucket = byRect.get(rect);
        if (bucket)
            bucket.push(node);
        else
            byRect.set(rect, [node]);
    }
    let matched = 0;
    let labelled = 0;
    for (const node of flattenNodes(dumpsysRoots)) {
        const own = node.visibleBounds ?? node.bounds;
        const shifted = {
            ...own,
            top: own.top + verticalOffset,
            bottom: own.bottom + verticalOffset,
        };
        const candidates = byRect.get(key(shifted));
        if (!candidates || candidates.length === 0)
            continue;
        const compatible = candidates.filter((candidate) => classesCompatible(node.className, candidate.className));
        if (compatible.length !== 1)
            continue;
        const source = compatible[0];
        if (source.text) {
            node.text = source.text;
            labelled += 1;
        }
        if (source.contentDescription)
            node.contentDescription = source.contentDescription;
        if (source.clickable)
            node.clickable = true;
        if (source.enabled === false)
            node.enabled = false;
        matched += 1;
    }
    return { matched, labelled, verticalOffset };
}
/**
 * Offset between the dumpsys window origin and the semantics screen origin.
 *
 * Both trees describe the same controls, so their bounding boxes line up
 * vertically after one constant shift. The median of the per-text-node
 * differences is stable even when some nodes do not correspond.
 */
function measureVerticalOffset(dumpsysRoots, semanticsRoots, screen) {
    const dumpsysTops = flattenNodes(dumpsysRoots)
        .filter((node) => node.visible && TEXT_LIKE.test(node.className))
        .map((node) => (node.visibleBounds ?? node.bounds).top);
    const semanticsTops = flattenNodes(semanticsRoots)
        .filter((node) => node.visible && (node.text || node.contentDescription))
        .map((node) => (node.visibleBounds ?? node.bounds).top);
    if (dumpsysTops.length === 0 || semanticsTops.length === 0)
        return 0;
    const differences = [];
    for (const top of dumpsysTops) {
        // The closest semantics top above or below is the corresponding node.
        let best = Number.POSITIVE_INFINITY;
        for (const candidate of semanticsTops) {
            const diff = candidate - top;
            if (Math.abs(diff) < Math.abs(best))
                best = diff;
        }
        if (Number.isFinite(best) && best >= 0)
            differences.push(best);
    }
    if (differences.length === 0)
        return 0;
    differences.sort((a, b) => a - b);
    const median = differences[Math.floor(differences.length / 2)];
    // A plausible offset is a small fraction of the screen, never a whole window.
    const limit = Math.max(1, Math.round((screen?.height ?? 2400) * 0.1));
    return median >= 0 && median <= limit ? median : 0;
}
const TEXT_LIKE = /Text|Button|Edit|Label/;
/**
 * A Text/Button/Image mapping to TextView/Button/ImageView is trustworthy.
 * Anything else is ambiguous: accessibility may flatten or insert wrappers, so
 * only same-family pairs are merged.
 */
function classesCompatible(dumpsysClass, semanticsClass) {
    const left = simpleClassName(dumpsysClass).toLowerCase();
    const right = simpleClassName(semanticsClass).toLowerCase();
    if (left === right)
        return true;
    const families = [
        [/textview|text|label/, /textview|text|label/],
        [/button/, /button/],
        [/image(view|button)?/, /image(view|button)?/],
        [/edittext|textfield/, /edittext|textfield/],
        [/checkbox|switch|toggle/, /checkbox|switch|toggle/],
        [/recyclerview|listview|gridview/, /recyclerview|listview|gridview/],
        [/viewgroup|layout|frame|linear|relative|constraint|coordinator/, /viewgroup|layout|frame|linear|relative|constraint|coordinator/],
    ];
    return families.some(([a, b]) => a.test(left) && b.test(right));
}
