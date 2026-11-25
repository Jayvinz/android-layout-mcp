import type { AnalyzeResult, Bounds, CaptureResult, Issue, NodeSource, UiNode } from "./model.js";
import { flattenNodes, intersect } from "./viewdump.js";
import { nodePath } from "./query.js";

export type RuleName =
  | "zero_size"
  | "offscreen"
  | "small_touch_target"
  | "invisible_clickable"
  | "unlabeled_clickable"
  | "duplicate_id"
  | "deep_nesting"
  | "overlap"
  | "clipped"
  | "outside_parent"
  | "overdraw"
  | "rtl_issues";

export interface AnalyzeOptions {
  rules?: RuleName[];
  minTouchTargetDp?: number;
  maxDepth?: number;
}

export function analyzeCapture(result: CaptureResult, options: AnalyzeOptions = {}): AnalyzeResult {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  const dp = result.screen.density || 1;
  const minTarget = (options.minTouchTargetDp ?? 48) * dp;
  const maxDepth = options.maxDepth ?? 14;
  const rules = new Set(options.rules ?? (Object.keys(RULES) as RuleName[]));

  // overdraw and rtl_issues read raw View properties, which are only present
  // when the capture requested them. If they are missing, the rules cannot
  // fire; say so instead of reporting a clean screen.
  const needsProperties = rules.has("overdraw") || rules.has("rtl_issues");
  let nodeCount = 0;

  const add = (issue: Issue) => {
    const key = `${issue.source}|${issue.rule}|${issue.nodeId}|${issue.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(issue);
  };
  const issueFor = (
    node: UiNode,
    rule: RuleName,
    severity: Issue["severity"],
    message: string,
    bounds: Bounds | null = node.visibleBounds ?? node.bounds,
  ): Issue => ({
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

  const analyzeSource = (roots: UiNode[], source: NodeSource) => {
    const nodes = flattenNodes(roots);
    nodeCount += nodes.length;
    const screen: Bounds = {
      left: 0,
      top: 0,
      right: result.screen.width,
      bottom: result.screen.height,
      width: result.screen.width,
      height: result.screen.height,
    };

    if (rules.has("zero_size")) {
      for (const node of nodes) {
        if (node.view?.visibility === "gone") continue;
        // uiautomator reports a few system placeholders with zero bounds; only
        // flag semantic nodes that are interactive.
        if (!node.view && !node.clickable) continue;
        if (node.bounds.width <= 0 || node.bounds.height <= 0) {
          add(issueFor(node, "zero_size", "warning", `View has zero size (${node.bounds.width}x${node.bounds.height}).`, node.bounds));
        }
      }
    }

    if (rules.has("offscreen")) {
      for (const node of nodes) {
        if (!node.view || node.view.visibility !== "visible") continue;
        if (node.bounds.width <= 0 || node.bounds.height <= 0) continue;
        const inside = intersect(node.bounds, screen);
        if (!inside) {
          add(issueFor(node, "offscreen", "warning", "Visible view is completely outside the screen.", node.bounds));
        }
      }
    }

    if (rules.has("small_touch_target")) {
      const rootBottom = roots[0]?.bounds.bottom ?? result.screen.height;
      const clippedByDump =
        source === "semantics" && result.screen.height > rootBottom + 1;
      for (const node of nodes) {
        if (!node.clickable || !node.visible) continue;
        const bounds = node.visibleBounds;
        if (!bounds) continue;
        // Some ROMs (MIUI) report the accessibility window shorter than the
        // real screen, which clips nodes at the bottom edge. Measuring them
        // would create false positives.
        if (clippedByDump && bounds.bottom >= rootBottom - 1) continue;
        const widthDp = bounds.width / dp;
        const heightDp = bounds.height / dp;
        if (bounds.width < minTarget || bounds.height < minTarget) {
          const which =
            bounds.width < minTarget && bounds.height < minTarget
              ? "both dimensions"
              : bounds.width < minTarget
                ? "width"
                : "height";
          add(
            issueFor(
              node,
              "small_touch_target",
              "warning",
              `Touch target is ${widthDp.toFixed(1)}x${heightDp.toFixed(1)}dp; ${which} below ${options.minTouchTargetDp ?? 48}dp.`,
            ),
          );
        }
      }
    }

    if (rules.has("invisible_clickable")) {
      for (const node of nodes) {
        if (!node.clickable) continue;
        const invisible = !node.visible || (node.view && node.view.visibility !== "visible") || !node.visibleBounds;
        if (invisible) {
          add(issueFor(node, "invisible_clickable", "warning", "Clickable element is not visible.", node.bounds));
        }
      }
    }

    if (rules.has("unlabeled_clickable")) {
      for (const node of nodes) {
        if (!node.clickable || !node.visible) continue;
        if (!nodeHasLabel(node)) {
          add(issueFor(node, "unlabeled_clickable", "info", "Clickable element has no text, content description, or resource id (including descendants)."));
        }
      }
    }

    if (rules.has("duplicate_id")) {
      const byId = new Map<string, UiNode[]>();
      for (const node of nodes) {
        if (!node.resourceId || !node.visible) continue;
        const list = byId.get(node.resourceId) ?? [];
        list.push(node);
        byId.set(node.resourceId, list);
      }
      for (const [id, list] of byId) {
        if (list.length > 1) {
          add(
            issueFor(
              list[0],
              "duplicate_id",
              "warning",
              `Resource id "${id}" is used by ${list.length} visible nodes (${list.map((n) => n.ref).join(", ")}).`,
            ),
          );
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

    if (rules.has("overdraw")) {
      // A node whose parent already paints an opaque background paints the same
      // pixels twice. Only same-tree, direct parent/child pairs are considered,
      // and only when the child fully covers the parent's visible area.
      const backgrounds = new Map<string, string>();
      const walkBackgrounds = (node: UiNode) => {
        const name = backgroundOf(node);
        if (name) backgrounds.set(node.id, name);
        for (const child of node.children) walkBackgrounds(child);
      };
      for (const root of roots) walkBackgrounds(root);
      for (const node of nodes) {
        if (!node.visible || !node.parent) continue;
        const own = backgrounds.get(node.id);
        if (!own) continue;
        const parentName = backgrounds.get(node.parent.id);
        if (!parentName) continue;
        if (own === parentName) continue;
        const outer = node.parent.visibleBounds;
        const inner = node.visibleBounds;
        if (!outer || !inner) continue;
        if (outer.width * outer.height <= 0) continue;
        if (inner.width >= outer.width * 0.98 && inner.height >= outer.height * 0.98) {
          add(
            issueFor(
              node,
              "overdraw",
              "info",
              `${own} is drawn over the parent's ${parentName} across the same area; one of the two backgrounds is redundant.`,
            ),
          );
        }
      }
    }

    if (rules.has("rtl_issues")) {
      // A hardcoded left/right offset does not mirror in RTL. The dump exposes
      // layout:left/right (resolved) and layoutParams.startMargin/endMargin
      // (Integer.MIN_VALUE when unset), so an absolute value with no start/end
      // counterpart is the signal.
      for (const node of nodes) {
        if (!node.visible) continue;
        const props = node.view?.properties;
        if (!props) continue;
        // Integer.MIN_VALUE is how the platform prints an unset start/end margin,
        // so it must count as "not set" rather than as a real value.
        const hasStart = isSetMargin(numberProp(props, "layoutParams.startMargin"));
        const hasEnd = isSetMargin(numberProp(props, "layoutParams.endMargin"));
        const left = numberProp(props, "layoutParams.leftMargin") ?? 0;
        const right = numberProp(props, "layoutParams.rightMargin") ?? 0;
        if (hasStart || hasEnd) continue;
        if (left === 0 && right === 0) continue;
        const side = left !== 0 && right !== 0 ? "left+right margins" : left !== 0 ? "leftMargin" : "rightMargin";
        add(
          issueFor(
            node,
            "rtl_issues",
            "warning",
            `Hardcoded ${side} without start/end; it will not mirror in RTL. Use marginStart/marginEnd.`,
          ),
        );
      }
    }

    if (rules.has("clipped")) {
      for (const node of nodes) {
        if (!node.visible || !node.visibleBounds) continue;
        const rawArea = node.bounds.width * node.bounds.height;
        const visibleArea = node.visibleBounds.width * node.visibleBounds.height;
        if (rawArea <= 0) continue;
        if (visibleArea < rawArea * 0.5 && !isScrollContent(node)) {
          add(
            issueFor(
              node,
              "clipped",
              "info",
              `${(100 - (visibleArea / rawArea) * 100).toFixed(0)}% of the node is clipped by an ancestor.`,
            ),
          );
        }
      }
    }

    if (rules.has("outside_parent")) {
      for (const node of nodes) {
        const parent = node.parent;
        if (!parent || !node.visible || !node.visibleBounds || !parent.visibleBounds) continue;
        if (parent.scrollable) continue;
        if (!containsBounds(parent.visibleBounds, node.visibleBounds)) {
          add(
            issueFor(
              node,
              "outside_parent",
              "warning",
              `Node extends outside its parent ${parent.ref} (${parent.shortClassName}).`,
            ),
          );
        }
      }
    }

    if (rules.has("overlap")) {
      for (const node of nodes) {
        if (node.children.length < 2) continue;
        const clickable = node.children.filter(
          (child) => child.clickable && child.visible && child.visibleBounds,
        );
        if (clickable.length < 2) continue;
        for (let i = 0; i < clickable.length; i++) {
          for (let j = i + 1; j < clickable.length; j++) {
            const a = clickable[i];
            const b = clickable[j];
            const overlap = intersect(a.visibleBounds!, b.visibleBounds!);
            if (!overlap) continue;
            const overlapArea = overlap.width * overlap.height;
            const minArea = Math.min(a.visibleBounds!.width * a.visibleBounds!.height, b.visibleBounds!.width * b.visibleBounds!.height);
            if (minArea <= 0) continue;
            if (overlapArea / minArea > 0.5) {
              add(
                issueFor(
                  a,
                  "overlap",
                  "warning",
                  `Overlaps sibling clickable ${b.ref} (${b.shortClassName}) by ${((overlapArea / minArea) * 100).toFixed(0)}%.`,
                  overlap,
                ),
              );
            }
          }
        }
      }
    }
  };

  if (result.view) analyzeSource(result.view.roots, "view");
  if (result.semantics) analyzeSource(result.semantics.roots, "semantics");
  if (result.compose) analyzeSource(result.compose.roots, "compose");

  const counts: Record<string, number> = {};
  for (const issue of issues) counts[issue.rule] = (counts[issue.rule] ?? 0) + 1;

  const skipped: string[] = [];
  if (needsProperties && result.view && !hasViewProperties(result.view.roots)) {
    skipped.push("overdraw, rtl_issues (raw View properties were not captured; add --props)");
  }
  if (needsProperties && !result.view) {
    skipped.push("overdraw, rtl_issues (need a debuggable app for raw View properties)");
  }
  const severityOrder: Record<Issue["severity"], number> = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.rule.localeCompare(b.rule));
  return { issues, counts, dp, nodeCount, ...(skipped.length ? { skipped } : {}) };
}

const RULES: Record<RuleName, true> = {
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
  overdraw: true,
  rtl_issues: true,
};

function containsBounds(outer: Bounds, inner: Bounds): boolean {
  return (
    inner.left >= outer.left - 1 &&
    inner.top >= outer.top - 1 &&
    inner.right <= outer.right + 1 &&
    inner.bottom <= outer.bottom + 1
  );
}

function isScrollContent(node: UiNode): boolean {
  let parent = node.parent;
  while (parent) {
    if (parent.scrollable) return true;
    parent = parent.parent;
  }
  return false;
}

function nodeHasLabel(node: UiNode): boolean {
  if (node.text || node.contentDescription || node.resourceId) return true;
  return node.children.some((child) => nodeHasLabel(child));
}

export function issuesToJson(result: AnalyzeResult): Record<string, unknown> {
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

/** Background drawable name from the raw View properties, if any. */
function backgroundOf(node: UiNode): string | null {
  const props = node.view?.properties;
  if (!props) return null;
  const value = props["miui:backgroundDrawableName"] ?? props["backgroundDrawableName"] ?? props["misc:background"];
  if (typeof value !== "string") return null;
  if (!value || value === "null") return null;
  return value.split(".").pop() ?? value;
}

function numberProp(props: Record<string, string | number | boolean>, key: string): number | null {
  const value = props[key];
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/** True when at least one node carries the raw property map. */
function hasViewProperties(roots: UiNode[]): boolean {
  return flattenNodes(roots).some((node) => {
    const props = node.view?.properties;
    return Boolean(props && Object.keys(props).length > 0);
  });
}

/** An unset margin is printed as Integer.MIN_VALUE, not as zero. */
function isSetMargin(value: number | null): boolean {
  return value !== null && value !== -2147483648;
}
