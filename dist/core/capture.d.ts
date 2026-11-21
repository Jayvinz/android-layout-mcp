import type { Adb } from "./adb.js";
import type { CaptureResult, NodeSource, SourceMode, UiKind, UiNode } from "./model.js";
export interface CaptureOptions {
    adb: Adb;
    source?: SourceMode;
    packageName?: string;
    pid?: number;
    window?: string;
    includeProperties?: boolean;
    requestTimeoutMs?: number;
    studioPath?: string;
    javaPath?: string;
    composeVersion?: string;
    composeInspectorJar?: string;
    onProgress?: (message: string) => void;
}
/**
 * Classifies the current screen from the ViewDebug tree:
 *  - xml:     no ComposeView at all
 *  - compose: ComposeView present and only framework/Compose wrappers
 *  - mixed:   ComposeView present plus XML content or AndroidView interop children
 */
export declare function classifyUi(viewRoots: UiNode[]): UiKind;
export declare function capture(options: CaptureOptions): Promise<CaptureResult>;
export declare function primaryRoots(result: CaptureResult, source?: NodeSource | SourceMode): UiNode[];
