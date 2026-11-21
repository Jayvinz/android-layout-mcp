import type { AnalyzeResult, CaptureResult } from "./model.js";
export type RuleName = "zero_size" | "offscreen" | "small_touch_target" | "invisible_clickable" | "unlabeled_clickable" | "duplicate_id" | "deep_nesting" | "overlap" | "clipped" | "outside_parent";
export interface AnalyzeOptions {
    rules?: RuleName[];
    minTouchTargetDp?: number;
    maxDepth?: number;
}
export declare function analyzeCapture(result: CaptureResult, options?: AnalyzeOptions): AnalyzeResult;
export declare function issuesToJson(result: AnalyzeResult): Record<string, unknown>;
