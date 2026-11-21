import type { CaptureResult, DumpFile, NodeSource } from "./model.js";
import type { SnapshotNode } from "./diff.js";
export declare function serializeDump(result: CaptureResult, includeProperties?: boolean): DumpFile;
export declare function saveDump(result: CaptureResult, path: string): Promise<void>;
export declare function loadDump(path: string): Promise<DumpFile>;
/** Returns the roots of the requested (or primary) source as diffable nodes. */
export declare function snapshotRoots(dump: DumpFile, source?: NodeSource): SnapshotNode[];
/**
 * Choose a source that exists in both dumps. Dumps captured with different
 * primary sources (e.g. source=both vs auto) would otherwise be compared
 * across trees, producing nonsense diffs.
 */
export declare function chooseDiffSource(before: DumpFile, after: DumpFile, explicit?: NodeSource): NodeSource;
