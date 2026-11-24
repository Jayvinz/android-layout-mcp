import type { Bounds, ScreenInfo, UiNode } from "./model.js";
export type PropValue = string | number | boolean | PropMap | null;
export interface PropMap {
    [key: string]: PropValue;
}
/**
 * Decodes the binary stream produced by android.view.ViewDebug.dumpv2().
 *
 * The stream is a sequence of objects. The first objects are a small header,
 * then one map per view (nested property maps included), and finally a map that
 * is the property-name string table.
 */
export declare function decodeViewHierarchy(buffer: Buffer): {
    views: PropMap[];
    propertyNames: Map<number, string>;
};
export interface ParseViewOptions {
    screen: ScreenInfo;
    packageName?: string | null;
    includeProperties?: boolean;
}
export declare function parseViewHierarchy(buffer: Buffer, options: ParseViewOptions): UiNode[];
export declare function intersect(a: Bounds, b: Bounds): Bounds | null;
export declare function normalizeResourceId(value: string | null): string | null;
export declare function simpleClassName(className: string): string;
/** Recursively assigns short refs in pre-order; used after any tree transform. */
export declare function assignRefs(roots: UiNode[], prefix: "v" | "s" | "d" | "c"): void;
/** Flattens a forest in pre-order. */
export declare function flattenNodes(roots: UiNode[]): UiNode[];
export interface SerializeNodeOptions {
    depth?: number;
    includeProps?: boolean;
    maxNodes?: number;
    counter?: {
        value: number;
    };
}
/** Serialises a node tree for JSON output, removing parent back-references. */
export declare function serializeNode(node: UiNode, options?: SerializeNodeOptions): unknown;
