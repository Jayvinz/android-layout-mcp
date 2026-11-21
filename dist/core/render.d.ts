import type { AnalyzeResult, CaptureResult, NodeSource, UiNode } from "./model.js";
export interface RenderTreeOptions {
    depth?: number;
    maxNodes?: number;
    showCenter?: boolean;
    visibleOnly?: boolean;
}
export declare function renderCapture(result: CaptureResult, source?: NodeSource | "both", options?: RenderTreeOptions): string;
export declare function renderTrees(roots: UiNode[], options?: RenderTreeOptions): string[];
export declare function renderIssues(result: AnalyzeResult, options?: {
    showPaths?: boolean;
}): string;
