import type { AnalyzeResult, CaptureResult, NodeSource, ScreenInfo, UiKind } from "./model.js";
import type { Screenshot } from "./screenshot.js";
/**
 * Interactive, self-contained HTML snapshot of one capture.
 *
 * Browser launch is always explicit: nothing in this module is called by
 * dump/find/analyze/screenshot/verify flows. The HTML has no network access
 * (CSP `connect-src 'none'`, no external assets) and every captured string is
 * written through `textContent` by the inline viewer script.
 */
export interface ViewerOptions {
    screenshot?: Screenshot | null;
    analysis?: AnalyzeResult | null;
    /** Maximum serialized nodes per tree. Default 4000. */
    maxNodes?: number;
    /** Embed raw `view.properties`. Default false. */
    includeProperties?: boolean;
    title?: string;
    createdAt?: string;
}
export interface ViewerTreePayload {
    source: NodeSource;
    roots: unknown[];
    /** Nodes actually serialized before the cap was hit. */
    nodeCount: number;
    /** Nodes present in the captured tree. */
    totalNodes: number;
    truncated: boolean;
}
export interface ViewerScreenshotPayload {
    dataUri: string;
    width: number;
    height: number;
    originalWidth: number;
    originalHeight: number;
    scale: number;
    /** Multiply an image coordinate by this to get a device coordinate. */
    imageToDevice: {
        x: number;
        y: number;
    };
}
export interface ViewerIssuePayload {
    rule: string;
    severity: string;
    source: NodeSource;
    nodeId: string;
    ref: string;
    className: string;
    label: string | null;
    message: string;
    bounds: unknown;
}
export interface ViewerIssuesPayload {
    counts: Record<string, number>;
    dp: number;
    nodeCount: number;
    issues: ViewerIssuePayload[];
}
export interface ViewerMeta {
    version: 1;
    createdAt: string;
    title: string;
    device: {
        serial: string;
        model: string | null;
        androidRelease: string | null;
        sdk: number | null;
    };
    target: {
        packageName: string | null;
        pid: number | null;
        activity: string | null;
        debuggable: boolean | null;
        window: string | null;
        windows: string[];
    };
    screen: ScreenInfo;
    source: NodeSource;
    primarySource: NodeSource;
    sources: NodeSource[];
    uiKind: UiKind;
    warnings: string[];
    limits: {
        maxNodes: number;
        includeProperties: boolean;
        budgetBytes: number;
        budgetExceeded: boolean;
    };
}
export interface ViewerPayload {
    meta: ViewerMeta;
    trees: Partial<Record<NodeSource, ViewerTreePayload>>;
    screenshot: ViewerScreenshotPayload | null;
    issues: ViewerIssuesPayload | null;
}
export interface OpenResult {
    opened: boolean;
    browser?: string;
    error?: string;
}
export interface OpenBrowserOptions {
    launcher?: (path: string) => Promise<void> | void;
}
export declare const VIEWER_BUDGET_BYTES: number;
export declare const DEFAULT_MAX_NODES = 4000;
/** `<baseDir or cwd>/.dli/viewer.html`, using the platform separator. */
export declare function defaultViewerPath(baseDir?: string): string;
/** Builds the embedded JSON payload, enforcing the 8 MB budget. */
export declare function viewerPayload(result: CaptureResult, options?: ViewerOptions): ViewerPayload;
/** Renders a complete, offline HTML document for one capture. */
export declare function renderViewerHtml(result: CaptureResult, options?: ViewerOptions): string;
/** Renders HTML for an already-built payload (avoids serialising twice). */
export declare function renderViewerHtmlFromPayload(payload: ViewerPayload): string;
/**
 * Opens a file in the default browser without waiting for the process.
 * Never throws: failures come back as `{ opened: false, error }`.
 */
export declare function openInBrowser(filePath: string, options?: OpenBrowserOptions): Promise<OpenResult>;
