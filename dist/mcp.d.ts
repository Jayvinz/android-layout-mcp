import { z } from "zod";
import type { CaptureResult, SourceMode } from "./core/model.js";
export interface McpServerOptions {
    serial?: string;
    adb?: string;
    timeout?: number;
    studioPath?: string;
    javaPath?: string;
    composeVersion?: string;
}
export declare const sourceSchema: z.ZodEnum<{
    auto: "auto";
    view: "view";
    semantics: "semantics";
    dumpsys: "dumpsys";
    compose: "compose";
    both: "both";
}>;
export declare const ruleSchema: z.ZodEnum<{
    zero_size: "zero_size";
    offscreen: "offscreen";
    small_touch_target: "small_touch_target";
    invisible_clickable: "invisible_clickable";
    unlabeled_clickable: "unlabeled_clickable";
    duplicate_id: "duplicate_id";
    deep_nesting: "deep_nesting";
    overlap: "overlap";
    clipped: "clipped";
    outside_parent: "outside_parent";
    overdraw: "overdraw";
    rtl_issues: "rtl_issues";
}>;
export declare function startMcpServer(options?: McpServerOptions): Promise<void>;
export interface DumpUiPayloadOptions {
    depth?: number;
    includeProperties?: boolean;
    maxNodes?: number;
    savePath?: string;
}
/** Builds the `dump_ui` JSON payload; one tree per captured source. */
export declare function buildDumpUiPayload(result: CaptureResult, options?: DumpUiPayloadOptions): Record<string, unknown>;
/**
 * Capture options for `analyze_ui`. overdraw and rtl_issues read raw View
 * properties, so they are requested by default; includeProperties=false opts
 * out, mirroring the CLI's `--no-props`.
 */
export declare function analyzeCaptureArgs(args: {
    includeProperties?: boolean;
}): {
    includeProperties: boolean;
};
/**
 * The tree(s) `hit_test` queries. `auto` means "both" (the View class plus the
 * accessibility node for the same point); every other requested source is
 * passed through unchanged, so `hit_test(source="dumpsys")` hit-tests dumpsys.
 */
export declare function hitTestSource(source?: SourceMode): SourceMode;
/**
 * Builds the per-tree reports `hit_test` returns. The `both` argument is derived
 * here from the requested source, so the handler cannot query a second tree by
 * accident; `treesFor` owns the actual source-to-trees policy.
 */
export declare function buildHitTestReports(result: CaptureResult, args: {
    x: number;
    y: number;
    index?: number;
    source?: SourceMode;
}): {
    tree: import("./core/model.js").NodeSource;
    selected: {
        path: string;
        index: number;
    } | null;
    candidates: {
        path: string;
        index: number;
    }[];
}[];
/** Ref prefixes are per source, so the hint must name the captured one. */
export declare function refHint(source: CaptureResult["source"]): string;
