import type { UiNode } from "./model.js";
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
export declare function findNodes(roots: UiNode[], options: FindOptions): NodeMatch[];
export interface HitTestOptions {
    includeInvisible?: boolean;
}
export interface HitTestResult {
    point: {
        x: number;
        y: number;
    };
    candidates: UiNode[];
    primary: UiNode | null;
}
/**
 * Hit-testing mirrors the "smallest area wins" selection used by
 * LayoutInspectorV2-Pro: collect every node under the point, then sort by
 * visible area ascending. Ties prefer deeper nodes (more specific), then later
 * siblings (drawn on top).
 */
export declare function hitTest(roots: UiNode[], x: number, y: number, options?: HitTestOptions): HitTestResult;
export declare function containsPoint(bounds: {
    left: number;
    top: number;
    right: number;
    bottom: number;
}, x: number, y: number): boolean;
export declare function area(bounds: {
    width: number;
    height: number;
}): number;
/** Human-readable path through the tree, e.g. FrameLayout > ComposeView > Text "推荐". */
export declare function nodePath(node: UiNode): string;
export declare function formatNodeLabel(node: UiNode): string;
export declare function nodeSummary(node: UiNode): Record<string, unknown>;
