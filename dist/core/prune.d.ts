import type { CaptureResult, UiNode } from "./model.js";
export interface CompactOptions {
    /** Keep hidden/gone nodes too (they are tagged `hidden` / `gone`). */
    includeInvisible?: boolean;
    /** Stop after this many kept nodes. */
    maxNodes?: number;
    /** Maximum kept-tree depth; deeper children are dropped. */
    maxDepth?: number;
}
export interface CompactResult {
    /** Kept nodes, nested after promotion. */
    nodes: CompactNode[];
    /** Nodes visited in the source tree. */
    total: number;
    /** Nodes kept after filtering. */
    kept: number;
    /** True when `maxNodes` or `maxDepth` cut the tree. */
    truncated: boolean;
}
export interface CompactNode {
    ref: string;
    class: string;
    id?: string;
    text?: string;
    desc?: string;
    bounds: string;
    center: [number, number];
    flags?: string[];
    compose?: {
        name: string;
        file: string;
        line: number;
    };
    depth?: number;
    children?: CompactNode[];
}
export interface CompactPayloadOptions extends CompactOptions {
    format?: "compact" | "flat";
    /** Depth limit applied to the compact tree (same meaning as `dump_ui.depth`). */
    depth?: number;
    savedTo?: string;
}
/**
 * A node earns its place in a compact tree when it says something or does
 * something. Pure layout wrappers (`FrameLayout`, `LinearLayout`, Compose
 * scaffolding) do not: they are dropped and their children are promoted, so the
 * result is the "nearest retained ancestor" tree an agent can read directly.
 */
export declare function isMeaningfulNode(node: UiNode): boolean;
/**
 * Filters a tree down to content/interactive nodes and promotes the children of
 * dropped containers. Mirrors the `android layout` host-side filters, minus the
 * device-side sidecar: the capture keeps everything, this is a projection.
 */
export declare function compactTree(roots: UiNode[], options?: CompactOptions): CompactResult;
/** Pre-order flattening that keeps `depth`, so the hierarchy stays recoverable. */
export declare function flattenCompactTree(nodes: CompactNode[], depth?: number): CompactNode[];
/**
 * The MCP/CLI payload for `format=compact` and `format=flat`. Both keep the
 * capture header so an agent can still tell which tree it is reading, and both
 * report how many nodes were dropped.
 */
export declare function buildCompactPayload(result: CaptureResult, options?: CompactPayloadOptions): Record<string, unknown>;
