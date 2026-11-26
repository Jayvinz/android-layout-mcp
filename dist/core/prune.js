const INTERACTION_CLASSES = new Set([
    "android.widget.Button",
    "android.widget.EditText",
    "android.widget.Switch",
    "android.widget.CheckBox",
    "android.widget.RadioButton",
]);
/**
 * A node earns its place in a compact tree when it says something or does
 * something. Pure layout wrappers (`FrameLayout`, `LinearLayout`, Compose
 * scaffolding) do not: they are dropped and their children are promoted, so the
 * result is the "nearest retained ancestor" tree an agent can read directly.
 */
export function isMeaningfulNode(node) {
    if (node.text || node.contentDescription)
        return true;
    if (node.clickable ||
        node.longClickable ||
        node.scrollable ||
        node.checkable ||
        node.selected ||
        node.checked ||
        node.focused ||
        node.password ||
        !node.enabled) {
        return true;
    }
    // A clickable custom view that reports nothing else is still a target.
    return INTERACTION_CLASSES.has(node.className) && node.visible;
}
function keepNode(node, includeInvisible) {
    if (!isMeaningfulNode(node))
        return false;
    if (!includeInvisible) {
        if (!node.visible)
            return false;
        const bounds = node.visibleBounds ?? node.bounds;
        if (bounds.width <= 0 || bounds.height <= 0)
            return false;
    }
    return true;
}
function rect(bounds) {
    return `[${bounds.left},${bounds.top}][${bounds.right},${bounds.bottom}]`;
}
function flagsFor(node) {
    const flags = [];
    if (node.clickable)
        flags.push("click");
    if (node.longClickable)
        flags.push("long-click");
    if (node.scrollable)
        flags.push("scroll");
    if (node.checkable)
        flags.push("checkable");
    if (node.checked)
        flags.push("checked");
    if (node.selected)
        flags.push("selected");
    if (node.focused)
        flags.push("focused");
    if (!node.enabled)
        flags.push("disabled");
    if (node.password)
        flags.push("password");
    if (!node.visible) {
        flags.push(node.view?.visibility === "gone" ? "gone" : "hidden");
        const bounds = node.bounds;
        if (bounds.width <= 0 || bounds.height <= 0)
            flags.push("zero-size");
    }
    return flags;
}
function toCompactNode(node) {
    const bounds = node.visibleBounds ?? node.bounds;
    const compact = {
        ref: node.ref,
        class: node.shortClassName,
        bounds: rect(bounds),
        center: [Math.round(node.center.x), Math.round(node.center.y)],
    };
    if (node.resourceId)
        compact.id = node.resourceId;
    if (node.text)
        compact.text = node.text;
    if (node.contentDescription)
        compact.desc = node.contentDescription;
    const flags = flagsFor(node);
    if (flags.length > 0)
        compact.flags = flags;
    if (node.compose) {
        compact.compose = {
            name: node.compose.name,
            file: node.compose.fileName,
            line: node.compose.lineNumber,
        };
    }
    return compact;
}
function pruneNode(node, depth, ctx) {
    ctx.total++;
    const kept = [];
    const keptHere = depth < (ctx.maxDepth ?? Number.POSITIVE_INFINITY);
    if (keptHere) {
        for (const child of node.children)
            kept.push(...pruneNode(child, depth + 1, ctx));
    }
    else if (node.children.length > 0) {
        ctx.truncated = true;
    }
    if (!keepNode(node, ctx.includeInvisible))
        return kept;
    if (ctx.maxNodes !== undefined && ctx.kept >= ctx.maxNodes) {
        ctx.truncated = true;
        return kept;
    }
    ctx.kept++;
    const compact = toCompactNode(node);
    compact.children = kept;
    return [compact];
}
/**
 * Filters a tree down to content/interactive nodes and promotes the children of
 * dropped containers. Mirrors the `android layout` host-side filters, minus the
 * device-side sidecar: the capture keeps everything, this is a projection.
 */
export function compactTree(roots, options = {}) {
    const ctx = {
        total: 0,
        kept: 0,
        truncated: false,
        includeInvisible: options.includeInvisible === true,
        maxNodes: options.maxNodes,
        maxDepth: options.maxDepth,
    };
    const nodes = [];
    for (const root of roots)
        nodes.push(...pruneNode(root, 0, ctx));
    return { nodes, total: ctx.total, kept: ctx.kept, truncated: ctx.truncated };
}
/** Pre-order flattening that keeps `depth`, so the hierarchy stays recoverable. */
export function flattenCompactTree(nodes, depth = 0) {
    const flat = [];
    for (const node of nodes) {
        const { children, ...rest } = node;
        flat.push({ ...rest, depth });
        if (children && children.length > 0)
            flat.push(...flattenCompactTree(children, depth + 1));
    }
    return flat;
}
/**
 * The MCP/CLI payload for `format=compact` and `format=flat`. Both keep the
 * capture header so an agent can still tell which tree it is reading, and both
 * report how many nodes were dropped.
 */
export function buildCompactPayload(result, options = {}) {
    const format = options.format ?? "compact";
    const stats = { nodes: 0, kept: 0, dropped: 0, truncated: false };
    const project = (roots) => {
        const pruned = compactTree(roots, {
            includeInvisible: options.includeInvisible,
            maxNodes: options.maxNodes,
            maxDepth: options.depth ?? options.maxDepth,
        });
        stats.nodes += pruned.total;
        stats.kept += pruned.kept;
        stats.dropped += pruned.total - pruned.kept;
        stats.truncated = stats.truncated || pruned.truncated;
        return format === "flat" ? flattenCompactTree(pruned.nodes) : pruned.nodes;
    };
    return {
        device: {
            serial: result.device.serial,
            model: result.device.model,
            androidRelease: result.device.androidRelease,
            sdk: result.device.sdk,
        },
        target: {
            packageName: result.target.packageName,
            pid: result.target.pid,
            activity: result.target.activity,
            window: result.target.selectedWindow,
        },
        screen: result.screen,
        source: result.source,
        sources: result.sources,
        uiKind: result.uiKind,
        format,
        stats,
        ...(result.stability ? { stability: result.stability } : {}),
        warnings: result.warnings,
        ...(result.view
            ? {
                view: result.view.windows
                    ? {
                        window: result.view.window,
                        windows: result.view.windows.map((window) => ({
                            name: window.name,
                            ...(window.selected ? { selected: true } : {}),
                            nodes: project(window.roots),
                        })),
                    }
                    : { window: result.view.window, nodes: project(result.view.roots) },
            }
            : {}),
        ...(result.semantics
            ? { semantics: { rotation: result.semantics.rotation, nodes: project(result.semantics.roots) } }
            : {}),
        ...(result.dumpsys
            ? {
                dumpsys: {
                    activity: result.dumpsys.activity,
                    fragments: result.dumpsys.fragments,
                    nodes: project(result.dumpsys.roots),
                },
            }
            : {}),
        ...(result.compose
            ? { compose: { rootViewId: result.compose.rootViewId, nodes: project(result.compose.roots) } }
            : {}),
        ...(options.savedTo ? { savedTo: options.savedTo } : {}),
        hint: compactHint(stats),
    };
}
/**
 * A Compose screen captured through the view source has no text or interaction
 * anywhere in it (ViewDebug stops at AndroidComposeView), so compact legitimately
 * keeps nothing. Say so instead of returning an unexplained empty array.
 */
function compactHint(stats) {
    if (stats.kept === 0 && stats.nodes > 0) {
        return (`compact kept 0 of ${stats.nodes} nodes: this tree has no text, description, interaction, or state. ` +
            "A Compose screen's ViewDebug tree stops at AndroidComposeView; use source=auto or source=semantics, " +
            "or format=json for the raw tree.");
    }
    return ("compact/flat drop nodes with no text, content description, interaction, or state, and promote " +
        "their children; use format=json for the full tree. ref stays valid for inspect/hit_test in this capture.");
}
