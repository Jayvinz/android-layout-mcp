import type { UiNode } from "./model.js";
import { flattenNodes } from "./viewdump.js";

export type MatchField = "text" | "contentDescription" | "resourceId" | "class" | "ref" | "path";
export type MatchMode = "contains" | "exact" | "regex";
export type FindBy = "any" | "text" | "desc" | "id" | "class" | "ref";

export interface FindOptions {
  query: string;
  by?: FindBy;
  match?: MatchMode;
  clickableOnly?: boolean;
  visibleOnly?: boolean;
  limit?: number;
}

export interface NodeMatch {
  node: UiNode;
  field: MatchField;
  path: string;
}

export function findNodes(roots: UiNode[], options: FindOptions): NodeMatch[] {
  const by = options.by ?? "any";
  const mode = options.match ?? "contains";
  const matcher = buildMatcher(options.query, mode);
  const matches: NodeMatch[] = [];
  for (const node of flattenNodes(roots)) {
    if (options.clickableOnly && !node.clickable) continue;
    if (options.visibleOnly !== false && !node.visible) continue;
    const fields = fieldsFor(node, by);
    for (const [field, value] of fields) {
      if (value === null) continue;
      if (matcher(value)) {
        matches.push({ node, field, path: nodePath(node) });
        break;
      }
    }
  }
  // Results are collected in pre-order, which is the most intuitive order for
  // agents and humans (ancestors before descendants).
  return options.limit && options.limit > 0 ? matches.slice(0, options.limit) : matches;
}

function fieldsFor(node: UiNode, by: FindBy): Array<[MatchField, string | null]> {
  switch (by) {
    case "text":
      return [["text", node.text]];
    case "desc":
      return [["contentDescription", node.contentDescription]];
    case "id":
      return [["resourceId", node.resourceId]];
    case "class":
      return [
        ["class", node.className],
        ["class", node.shortClassName],
      ];
    case "ref":
      return [["ref", node.ref]];
    default:
      return [
        ["text", node.text],
        ["contentDescription", node.contentDescription],
        ["resourceId", node.resourceId],
        ["class", node.className],
        ["ref", node.ref],
        ["path", node.id],
      ];
  }
}

function buildMatcher(query: string, mode: MatchMode): (value: string) => boolean {
  if (mode === "regex" || (query.startsWith("/") && query.lastIndexOf("/") > 0)) {
    let pattern = query;
    let flags = "i";
    if (query.startsWith("/")) {
      const last = query.lastIndexOf("/");
      if (last > 0) {
        flags = query.slice(last + 1) || "i";
        pattern = query.slice(1, last);
      }
    }
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, flags);
    } catch {
      throw new Error(`Invalid regular expression: ${query}`);
    }
    return (value) => regex.test(value);
  }
  if (mode === "exact") {
    return (value) => value === query;
  }
  const needle = query.toLowerCase();
  return (value) => value.toLowerCase().includes(needle);
}

export interface HitTestOptions {
  includeInvisible?: boolean;
}

export interface HitTestResult {
  point: { x: number; y: number };
  candidates: UiNode[];
  primary: UiNode | null;
}

/**
 * Hit-testing mirrors the "smallest area wins" selection used by
 * LayoutInspectorV2-Pro: collect every node under the point, then sort by
 * visible area ascending. Ties prefer deeper nodes (more specific), then later
 * siblings (drawn on top).
 */
export function hitTest(
  roots: UiNode[],
  x: number,
  y: number,
  options: HitTestOptions = {},
): HitTestResult {
  const candidates: UiNode[] = [];
  for (const node of flattenNodes(roots)) {
    if (!options.includeInvisible && !node.visible) continue;
    const bounds = options.includeInvisible ? node.bounds : node.visibleBounds ?? node.bounds;
    if (containsPoint(bounds, x, y)) candidates.push(node);
  }
  candidates.sort((a, b) => {
    const areaA = area(a.visibleBounds ?? a.bounds);
    const areaB = area(b.visibleBounds ?? b.bounds);
    if (areaA !== areaB) return areaA - areaB;
    if (a.depth !== b.depth) return b.depth - a.depth;
    return b.index - a.index;
  });
  return { point: { x, y }, candidates, primary: candidates[0] ?? null };
}

export function containsPoint(bounds: { left: number; top: number; right: number; bottom: number }, x: number, y: number): boolean {
  return x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom;
}

export function area(bounds: { width: number; height: number }): number {
  return Math.max(0, bounds.width) * Math.max(0, bounds.height);
}

/** Human-readable path through the tree, e.g. FrameLayout > ComposeView > Text "推荐". */
export function nodePath(node: UiNode): string {
  const parts: string[] = [];
  let current: UiNode | null | undefined = node;
  while (current) {
    parts.unshift(formatNodeLabel(current));
    current = current.parent;
  }
  return parts.join(" > ");
}

export function formatNodeLabel(node: UiNode): string {
  if (node.compose) {
    const location = node.compose.fileName
      ? ` ${node.compose.fileName}:${node.compose.lineNumber}`
      : "";
    const label = node.text || node.contentDescription;
    return `${node.compose.name}${location}${label ? ` "${label.slice(0, 40)}"` : ""}`;
  }
  const label = node.text || node.contentDescription;
  if (label) {
    const trimmed = label.length > 60 ? `${label.slice(0, 57)}...` : label;
    return `${node.shortClassName} "${trimmed.replace(/\s+/g, " ")}"`;
  }
  if (node.resourceId) return `${node.shortClassName} ${node.resourceId}`;
  return node.shortClassName;
}

export function nodeSummary(node: UiNode): Record<string, unknown> {
  return {
    id: node.id,
    ref: node.ref,
    source: node.source,
    className: node.className,
    resourceId: node.resourceId,
    text: node.text,
    contentDescription: node.contentDescription,
    bounds: node.bounds,
    visibleBounds: node.visibleBounds,
    center: { x: Math.round(node.center.x), y: Math.round(node.center.y) },
    visible: node.visible,
    clickable: node.clickable,
    enabled: node.enabled,
    scrollable: node.scrollable,
    depth: node.depth,
    ...(node.compose
      ? {
          composable: node.compose.name,
          file: node.compose.fileName,
          line: node.compose.lineNumber,
          recomposeCount: node.compose.recomposeCount,
          recomposeSkips: node.compose.recomposeSkips,
          flags: node.compose.flags,
        }
      : {}),
  };
}
