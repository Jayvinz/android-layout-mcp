import type { Bounds, NodeSource } from "./model.js";
/** Minimal node shape from a serialised dump file. */
export interface SnapshotNode {
    id: string;
    ref: string;
    source: NodeSource;
    className: string;
    resourceId: string | null;
    text: string | null;
    contentDescription: string | null;
    bounds: Bounds;
    visibleBounds: Bounds | null;
    clickable?: boolean;
    children: SnapshotNode[];
}
export interface DiffEntry {
    kind: "added" | "removed" | "changed";
    key: string;
    source: NodeSource;
    label: string;
    before: SnapshotNode | null;
    after: SnapshotNode | null;
    changes: string[];
}
export interface DiffResult {
    added: DiffEntry[];
    removed: DiffEntry[];
    changed: DiffEntry[];
    summary: {
        added: number;
        removed: number;
        changed: number;
    };
}
export interface DiffOptions {
    source?: NodeSource;
    boundsTolerance?: number;
}
export declare function diffSnapshots(before: SnapshotNode[], after: SnapshotNode[], options?: DiffOptions): DiffResult;
export declare function renderDiff(result: DiffResult): string;
