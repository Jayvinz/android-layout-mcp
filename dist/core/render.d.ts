import type { AnalyzeResult, CaptureResult, NodeSource, SourceMode, StabilityInfo, UiNode } from "./model.js";
export interface RenderTreeOptions {
    depth?: number;
    maxNodes?: number;
    showCenter?: boolean;
    visibleOnly?: boolean;
}
/** `auto` means "use result.source"; renderCapture's other values are explicit. */
export declare function renderSource(source?: SourceMode): NodeSource | "both" | undefined;
export declare function renderCapture(result: CaptureResult, source?: NodeSource | "both", options?: RenderTreeOptions): string;
export declare function renderTrees(roots: UiNode[], options?: RenderTreeOptions): string[];
/** One header line for the optional settle probe. */
export declare function formatStability(stability: StabilityInfo): string;
export declare function renderIssues(result: AnalyzeResult, options?: {
    showPaths?: boolean;
}): string;
