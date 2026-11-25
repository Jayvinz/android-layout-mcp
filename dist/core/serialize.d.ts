import type { CaptureResult, DumpFile } from "./model.js";
export declare function serializeDump(result: CaptureResult, includeProperties?: boolean): DumpFile;
export declare function saveDump(result: CaptureResult, path: string): Promise<void>;
export declare function loadDump(path: string): Promise<DumpFile>;
