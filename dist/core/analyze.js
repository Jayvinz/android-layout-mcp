import { flattenNodes, intersect } from "./viewdump.js";
import { nodePath } from "./query.js";
export function analyzeCapture(result, options = {}) {
    const issues = [];
    const seen = new Set();
    const dp = result.screen.density || 1;
    const minTarget = (options.minTouchTargetDp ?? 48) * dp;
    const maxDepth = options.maxDepth ?? 14;
    const rules = new Set(options.rules ?? Object.keys(RULES));
    let nodeCount = 0;
    const add = (issue) => {
        const key = `${issue.source}|${issue.rule}|${issue.nodeId}|${issue.message}`;
        if (seen.has(key))
            return;
        seen.add(key);
        issues.push(issue);
    };
    const issueFor = (node, rule, severity, message, bounds = node.visibleBounds ?? node.bounds) => ({
        rule,
        severity,
        message,
        nodeId: node.id,
        nodeRef: node.ref,
        source: node.source,
        className: node.shortClassName,
        label: node.text || node.contentDescription,
        bounds,
        path: nodePath(node),
    });
    const analyzeSource = (roots, source) => {
        const nodes = flattenNodes(roots);
        nodeCount += nodes.length;
        const screen = {
            left: 0,
            top: 0,
            right: result.screen.width,
            bottom: result.screen.height,
            width: result.screen.width,
            height: result.screen.height,
        };
        if (rules.has("zero_size")) {
            for (const node of nodes) {
                if (node.view?.visibility === "gone")
                    continue;
                // uiautomator reports a few system placeholders with zero bounds; only
                // flag semantic nodes that are interactive.
                if (!node.view && !node.clickable)
                    continue;
                if (node.bounds.width <= 0 || node.bounds.height <= 0) {
                    add(issueFor(node, "zero_size", "warning", `View has zero size (${node.bounds.width}x${node.bounds.height}).`, node.bounds));
                }
            }
        }
        if (rules.has("offscreen")) {
            for (const node of nodes) {
                if (!node.view || node.view.visibility !== "visible")
                    continue;
                if (node.bounds.width <= 0 || node.bounds.height <= 0)
                    continue;
                const inside = intersect(node.bounds, screen);
                if (!inside) {
                    add(issueFor(node, "offscreen", "warning", "Visible view is completely outside the screen.", node.bounds));
                }
            }
        }
        if (rules.has("small_touch_target")) {
            const rootBottom = roots[0]?.bounds.bottom ?? result.screen.height;
            const clippedByDump = source === "semantics" && result.screen.height > rootBottom + 1;
            for (const node of nodes) {
                if (!node.clickable || !node.visible)
                    continue;
                const bounds = node.visibleBounds;
                if (!bounds)
                    continue;
                // Some ROMs (MIUI) report the accessibility window shorter than the
                // real screen, which clips nodes at the bottom edge. Measuring them
                // would create false positives.
                if (clippedByDump && bounds.bottom >= rootBottom - 1)
                    continue;
                const widthDp = bounds.width / dp;
                const heightDp = bounds.height / dp;
                if (bounds.width < minTarget || bounds.height < minTarget) {
                    const which = bounds.width < minTarget && bounds.height < minTarget
                        ? "both dimensions"
                        : bounds.width < minTarget
                            ? "width"
                            : "height";
                    add(issueFor(node, "small_touch_target", "warning", `Touch target is ${widthDp.toFixed(1)}x${heightDp.toFixed(1)}dp; ${which} below ${options.minTouchTargetDp ?? 48}dp.`));
                }
            }
        }
        if (rules.has("invisible_clickable")) {
            for (const node of nodes) {
                if (!node.clickable)
                    continue;
                const invisible = !node.visible || (node.view && node.view.visibility !== "visible") || !node.visibleBounds;
                if (invisible) {
                    add(issueFor(node, "invisible_clickable", "warning", "Clickable element is not visible.", node.bounds));
                }
            }
        }
        if (rules.has("unlabeled_clickable")) {
            for (const node of nodes) {
                if (!node.clickable || !node.visible)
                    continue;
                if (!nodeHasLabel(node)) {
                    add(issueFor(node, "unlabeled_clickable", "info", "Clickable element has no text, content description, or resource id (including descendants)."));
                }
            }
        }
        if (rules.has("duplicate_id")) {
            const byId = new Map();
            for (const node of nodes) {
                if (!node.resourceId || !node.visible)
                    continue;
                const list = byId.get(node.resourceId) ?? [];
                list.push(node);
                byId.set(node.resourceId, list);
            }
            for (const [id, list] of byId) {
                if (list.length > 1) {
                    add(issueFor(list[0], "duplicate_id", "warning", `Resource id "${id}" is used by ${list.length} visible nodes (${list.map((n) => n.ref).join(", ")}).`));
                }
            }
        }
        if (rules.has("deep_nesting") && source !== "compose") {
            for (const node of nodes) {
                if (node.depth >= maxDepth && node.visible) {
                    add(issueFor(node, "deep_nesting", "info", `Depth ${node.depth} exceeds ${maxDepth}; consider flattening the hierarchy.`));
                }
            }
        }
        if (rules.has("clipped")) {
            for (const node of nodes) {
                if (!node.visible || !node.visibleBounds)
                    continue;
                const rawArea = node.bounds.width * node.bounds.height;
                const visibleArea = node.visibleBounds.width * node.visibleBounds.height;
                if (rawArea <= 0)
                    continue;
                if (visibleArea < rawArea * 0.5 && !isScrollContent(node)) {
                    add(issueFor(node, "clipped", "info", `${(100 - (visibleArea / rawArea) * 100).toFixed(0)}% of the node is clipped by an ancestor.`));
                }
            }
        }
        if (rules.has("outside_parent")) {
            for (const node of nodes) {
                const parent = node.parent;
                if (!parent || !node.visible || !node.visibleBounds || !parent.visibleBounds)
                    continue;
                if (parent.scrollable)
                    continue;
                if (!containsBounds(parent.visibleBounds, node.visibleBounds)) {
                    add(issueFor(node, "outside_parent", "warning", `Node extends outside its parent ${parent.ref} (${parent.shortClassName}).`));
                }
            }
        }
        if (rules.has("overlap")) {
            for (const node of nodes) {
                if (node.children.length < 2)
                    continue;
                const clickable = node.children.filter((child) => child.clickable && child.visible && child.visibleBounds);
                if (clickable.length < 2)
                    continue;
                for (let i = 0; i < clickable.length; i++) {
                    for (let j = i + 1; j < clickable.length; j++) {
                        const a = clickable[i];
                        const b = clickable[j];
                        const overlap = intersect(a.visibleBounds, b.visibleBounds);
                        if (!overlap)
                            continue;
                        const overlapArea = overlap.width * overlap.height;
                        const minArea = Math.min(a.visibleBounds.width * a.visibleBounds.height, b.visibleBounds.width * b.visibleBounds.height);
                        if (minArea <= 0)
                            continue;
                        if (overlapArea / minArea > 0.5) {
                            add(issueFor(a, "overlap", "warning", `Overlaps sibling clickable ${b.ref} (${b.shortClassName}) by ${((overlapArea / minArea) * 100).toFixed(0)}%.`, overlap));
                        }
                    }
                }
            }
        }
    };
    if (result.view)
        analyzeSource(result.view.roots, "view");
    if (result.semantics)
        analyzeSource(result.semantics.roots, "semantics");
    if (result.compose)
        analyzeSource(result.compose.roots, "compose");
    const counts = {};
    for (const issue of issues)
        counts[issue.rule] = (counts[issue.rule] ?? 0) + 1;
    const severityOrder = { error: 0, warning: 1, info: 2 };
    issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.rule.localeCompare(b.rule));
    return { issues, counts, dp, nodeCount };
}
const RULES = {
    zero_size: true,
    offscreen: true,
    small_touch_target: true,
    invisible_clickable: true,
    unlabeled_clickable: true,
    duplicate_id: true,
    deep_nesting: true,
    overlap: true,
    clipped: true,
    outside_parent: true,
};
function containsBounds(outer, inner) {
    return (inner.left >= outer.left - 1 &&
        inner.top >= outer.top - 1 &&
        inner.right <= outer.right + 1 &&
        inner.bottom <= outer.bottom + 1);
}
function isScrollContent(node) {
    let parent = node.parent;
    while (parent) {
        if (parent.scrollable)
            return true;
        parent = parent.parent;
    }
    return false;
}
function nodeHasLabel(node) {
    if (node.text || node.contentDescription || node.resourceId)
        return true;
    return node.children.some((child) => nodeHasLabel(child));
}
export function issuesToJson(result) {
    return {
        counts: result.counts,
        dp: result.dp,
        nodeCount: result.nodeCount,
        issues: result.issues.map((issue) => ({
            rule: issue.rule,
            severity: issue.severity,
            source: issue.source,
            nodeId: issue.nodeId,
            ref: issue.nodeRef,
            className: issue.className,
            label: issue.label ? issue.label.slice(0, 80) : null,
            message: issue.message,
            bounds: issue.bounds,
        })),
    };
}
