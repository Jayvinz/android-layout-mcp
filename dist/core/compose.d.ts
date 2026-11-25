import type { Adb } from "./adb.js";
import type { ScreenInfo, UiNode } from "./model.js";
export interface ComposeCaptureOptions {
    adb: Adb;
    deviceSerial: string;
    packageName: string;
    pid: number;
    /** Used for validation only; Compose bounds are already screen coordinates. */
    screen?: ScreenInfo;
    timeoutMs?: number;
    studioPath?: string;
    javaPath?: string;
    composeVersion?: string;
    composeInspectorJar?: string;
    onProgress?: (message: string) => void;
}
export interface ComposeCaptureResult {
    rootViewId: number;
    roots: UiNode[];
    captureMs: number;
    warnings: string[];
}
interface StudioPaths {
    root: string;
    resources: string;
    lib: string;
    java: string | null;
    version: string | null;
    buildNumber: string | null;
    javac: string | null;
    jarTool: string | null;
}
interface HelperNode {
    id: string;
    name: string;
    fileName: string;
    lineNumber: number;
    offset: number;
    anchorHash: number;
    recomposeCount: number;
    recomposeSkips: number;
    flags: string[];
    text?: string;
    contentDescription?: string;
    bounds?: {
        left: number;
        top: number;
        width: number;
        height: number;
    };
    renderQuad?: number[];
    depth?: number;
    children: HelperNode[];
}
export interface HelperRoot {
    viewId: number;
    nodes: HelperNode[];
}
export declare function captureComposeTree(options: ComposeCaptureOptions): Promise<ComposeCaptureResult>;
export type StudioSource = "explicit" | "env" | "default" | "process";
export interface StudioLocation extends StudioPaths {
    source: StudioSource;
}
/**
 * Resolves an Android Studio installation.
 *
 * Order:
 *   1. --studio / ALM_ANDROID_STUDIO / ANDROID_STUDIO_PATH
 *   2. the running studio64/studio process (the install the developer is actually
 *      using; also catches custom and Toolbox installs)
 *   3. standard install locations
 *
 * Process detection is cached for one hour. On Windows it costs roughly
 * 1.5-2s because PowerShell must start; the cache keeps that out of repeated
 * MCP/session calls.
 */
export declare function locateAndroidStudio(explicit?: string): Promise<StudioLocation>;
/** Finds Studio installations from running IDE processes (custom paths, Toolbox, ...). */
export declare function detectRunningStudioRoots(): Promise<string[]>;
/** Exported for tests; the search order is user-visible via `docs/data-sources.md`. */
export declare function resolveJava(explicit: string | undefined, studio: {
    java?: string | null;
}, warn?: (message: string) => void): Promise<string>;
export declare function buildComposeRoots(roots: HelperRoot[], packageName: string): UiNode[];
export {};
