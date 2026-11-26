import type { Adb } from "./adb.js";
import type { CaptureResult, NodeSource, SourceMode, UiKind, UiNode, WindowInfo } from "./model.js";
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
    /** Wait for the app to stop producing frames before capturing. */
    settle?: boolean;
    settleTimeoutMs?: number;
    settleIntervalMs?: number;
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
/** The `window` value that captures every window of the app's process. */
export declare const CAPTURE_ALL_WINDOWS = "all";
/**
 * JDWP lists windows in creation order, not focus order: when a translucent
 * activity or a dialog sits on top, the first window can be the invisible one
 * behind it. Put the focused window first so the default capture (and the
 * primary tree of `window=all`) is the one the user is looking at.
 */
export declare function orderByFocus(windows: WindowInfo[], token: string | null): WindowInfo[];
export declare function chooseWindows(windows: WindowInfo[], requested: string | undefined, packageName: string | null): WindowInfo[];
/**
 * The single source-to-trees policy shared by the CLI and MCP server.
 * `auto` follows the captured primary source, but mixed screens expose both
 * trees so callers can search/locate XML and Compose content.
 */
export declare function treesFor(result: CaptureResult, source?: SourceMode, both?: boolean): Array<[NodeSource, UiNode[]]>;
