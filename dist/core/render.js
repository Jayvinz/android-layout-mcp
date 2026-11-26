/** `auto` means "use result.source"; renderCapture's other values are explicit. */
export function renderSource(source) {
    return source === "auto" ? undefined : source;
}
export function renderCapture(result, source, options = {}) {
    const lines = [];
    const device = result.device;
    const screen = result.screen;
    lines.push(`device ${device.serial}${device.model ? ` (${device.model})` : ""}  ` +
        `android ${device.androidRelease ?? "?"} (sdk ${device.sdk ?? "?"})`);
    lines.push(`screen ${screen.width}x${screen.height} @ ${screen.densityDpi}dpi (${screen.density.toFixed(2)}x) ` +
        `${screen.orientation}${screen.rotation !== null ? ` rotation=${screen.rotation}` : ""}`);
    lines.push(`target ${result.target.packageName ?? "?"}${result.target.pid ? ` pid=${result.target.pid}` : ""}` +
        `${result.target.activity ? ` activity=${result.target.activity}` : ""}` +
        `${result.target.debuggable === true ? " debuggable" : ""}`);
    lines.push(`primary source: ${result.source} (captured: ${result.sources.join(", ")})`);
    lines.push(`ui kind: ${result.uiKind}` +
        (result.uiKind === "mixed" ? " (view + semantics; both trees rendered below)" : ""));
    if (result.stability)
        lines.push(formatStability(result.stability));
    if (result.view) {
        lines.push(result.view.windows && result.view.windows.length > 1
            ? `view windows: ${result.view.windows.length} (primary: ${result.view.window}, ${result.view.captureMs}ms)`
            : `view window: ${result.view.window} (${result.view.captureMs}ms)`);
    }
    if (result.semantics) {
        lines.push(`semantics rotation=${result.semantics.rotation} (${result.semantics.captureMs}ms)`);
    }
    if (result.dumpsys) {
        lines.push(`dumpsys activity=${result.dumpsys.activity ?? "?"} (${result.dumpsys.captureMs}ms, ` +
            `${result.dumpsys.labelledNodes} nodes labelled from semantics)`);
        for (const fragment of result.dumpsys.fragments) {
            const state = fragmentState(fragment.state);
            const flags = [
                fragment.added ? "added" : "not-added",
                fragment.hidden ? "hidden" : null,
                fragment.detached ? "detached" : null,
            ]
                .filter(Boolean)
                .join(",");
            lines.push(`  fragment ${fragment.shortClassName ?? fragment.className ?? "?"}` +
                `${fragment.tag ? ` tag=${fragment.tag}` : ""}${state ? ` ${state}` : ""} (${flags})`);
        }
    }
    if (result.compose) {
        lines.push(`compose root view id=${result.compose.rootViewId} (${result.compose.captureMs}ms)`);
    }
    for (const warning of result.warnings)
        lines.push(`warning: ${warning}`);
    const renderBoth = source === "both" || (source === undefined && result.uiKind === "mixed");
    if (renderBoth) {
        if (result.view) {
            lines.push("", "── view hierarchy ──");
            lines.push(...renderViewTrees(result.view, options));
        }
        if (result.semantics) {
            lines.push("", "── semantics tree ──");
            lines.push(...renderTrees(result.semantics.roots, options));
        }
    }
    else {
        const roots = source === "semantics"
            ? result.semantics?.roots
            : source === "compose"
                ? result.compose?.roots
                : source === "view"
                    ? result.view?.roots
                    : source === "dumpsys"
                        ? result.dumpsys?.roots
                        : result.source === "semantics"
                            ? result.semantics?.roots
                            : result.source === "compose"
                                ? result.compose?.roots
                                : result.source === "dumpsys"
                                    ? result.dumpsys?.roots
                                    : result.view?.roots;
        if (roots) {
            const viewTrees = source === "view" || (source === undefined && result.source === "view")
                ? result.view
                : undefined;
            lines.push("", ...(viewTrees ? renderViewTrees(viewTrees, options) : renderTrees(roots, options)));
        }
    }
    return lines.join("\n");
}
/**
 * One window per section when `window=all` captured several, otherwise the
 * single tree as before. The primary window is named and marked so a reader can
 * tell which tree the rest of the capture (find/hit/analyze) used.
 */
function renderViewTrees(view, options) {
    if (!view.windows || view.windows.length < 2)
        return renderTrees(view.roots, options);
    const lines = [];
    for (const window of view.windows) {
        lines.push(`${window.selected ? "primary" : "window"}: ${window.name}`, ...renderTrees(window.roots, options), "");
    }
    lines.pop();
    return lines;
}
export function renderTrees(roots, options = {}) {
    const lines = [];
    let count = 0;
    const maxNodes = options.maxNodes ?? Number.POSITIVE_INFINITY;
    const maxDepth = options.depth;
    const walk = (node, depth) => {
        if (count >= maxNodes)
            return;
        if (options.visibleOnly && !node.visible)
            return;
        count++;
        lines.push(`${"  ".repeat(depth)}${formatLine(node, options)}`);
        if (maxDepth !== undefined && depth >= maxDepth) {
            if (node.children.length > 0) {
                lines.push(`${"  ".repeat(depth + 1)}… ${node.children.length} children (depth limit)`);
            }
            return;
        }
        for (const child of node.children)
            walk(child, depth + 1);
    };
    for (const root of roots)
        walk(root, 0);
    if (count >= maxNodes) {
        lines.push(`… truncated at ${maxNodes} nodes (use --depth/--max-nodes or JSON output for more)`);
    }
    return lines;
}
/** One header line for the optional settle probe. */
export function formatStability(stability) {
    if (stability.stable === true) {
        return `stable: yes (settled in ${stability.waitedMs}ms, ${stability.samples.length} samples)`;
    }
    if (stability.stable === false) {
        return (`stable: no — ${stability.framesPerInterval ?? "?"} frames in the last ` +
            `${stability.measuredIntervalMs ?? stability.intervalMs}ms ` +
            `after ${stability.waitedMs}ms; the snapshot may be mid-animation`);
    }
    return `stable: unknown (${stability.hint ?? "frame counter unavailable"})`;
}
function formatLine(node, options) {
    const parts = [`${node.ref}`, node.shortClassName];
    if (node.compose) {
        if (node.compose.fileName)
            parts.push(`${node.compose.fileName}:${node.compose.lineNumber}`);
        const composeText = node.text || node.contentDescription;
        if (composeText) {
            parts.push(JSON.stringify(composeText.length > 50 ? `${composeText.slice(0, 47)}...` : composeText));
        }
    }
    else {
        const label = node.text || node.contentDescription;
        if (label)
            parts.push(JSON.stringify(label.length > 50 ? `${label.slice(0, 47)}...` : label));
        if (node.resourceId && node.resourceId !== label)
            parts.push(node.resourceId);
    }
    const bounds = node.bounds;
    parts.push(`[${bounds.left},${bounds.top}][${bounds.right},${bounds.bottom}] ${bounds.width}x${bounds.height}`);
    if (options.showCenter) {
        parts.push(`@(${Math.round(node.center.x)},${Math.round(node.center.y)})`);
    }
    const flags = [];
    if (node.compose) {
        for (const flag of node.compose.flags)
            flags.push(flag.toLowerCase());
        if (node.compose.recomposeCount > 0)
            flags.push(`recompose=${node.compose.recomposeCount}`);
        if (node.compose.recomposeSkips > 0)
            flags.push(`skip=${node.compose.recomposeSkips}`);
    }
    if (node.clickable)
        flags.push("click");
    if (node.scrollable)
        flags.push("scroll");
    if (node.checkable)
        flags.push(node.checked ? "checked" : "checkable");
    if (!node.enabled)
        flags.push("disabled");
    if (node.view?.visibility === "invisible")
        flags.push("invisible");
    if (node.view?.visibility === "gone")
        flags.push("gone");
    else if (!node.visible)
        flags.push("hidden");
    if (flags.length > 0)
        parts.push(`{${flags.join(",")}}`);
    return parts.join(" ");
}
export function renderIssues(result, options = {}) {
    if (result.issues.length === 0) {
        return `No layout issues detected in ${result.nodeCount} nodes.`;
    }
    const lines = [];
    const severityIcon = {
        error: "✖",
        warning: "⚠",
        info: "ℹ",
    };
    lines.push(`${result.issues.length} issue(s) in ${result.nodeCount} nodes (density ${result.dp.toFixed(1)}dp):`);
    const grouped = new Map();
    for (const issue of result.issues) {
        const list = grouped.get(issue.rule) ?? [];
        list.push(issue);
        grouped.set(issue.rule, list);
    }
    for (const [rule, issues] of grouped) {
        lines.push("", `${rule} (${issues.length})`);
        for (const issue of issues) {
            const bounds = issue.bounds
                ? `[${issue.bounds.left},${issue.bounds.top}][${issue.bounds.right},${issue.bounds.bottom}]`
                : "[-]";
            lines.push(`  ${severityIcon[issue.severity]} ${issue.nodeRef} ${issue.className}` +
                `${issue.label ? ` "${truncate(issue.label, 40)}"` : ""} ${bounds} — ${issue.message}` +
                `${options.showPaths ? `\n      ${issue.path}` : ""}`);
        }
    }
    return lines.join("\n");
}
function truncate(value, length) {
    const single = value.replace(/\s+/g, " ").trim();
    return single.length > length ? `${single.slice(0, length - 3)}...` : single;
}
/** Fragment lifecycle state as printed by `dumpsys` (Fragment constants). */
function fragmentState(state) {
    if (state === null)
        return null;
    const names = {
        0: "ATTACHED",
        1: "CREATED",
        2: "VIEW_CREATED",
        3: "STARTED",
        4: "RESUMED",
        5: "RESUMED",
    };
    return names[state] ?? `state=${state}`;
}
