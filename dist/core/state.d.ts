import type { Adb } from "./adb.js";
import type { DeviceInfo, ForegroundApp, ScreenInfo, WindowInfo } from "./model.js";
/**
 * One timeout for the short JDWP window probe. `state` is a cheap status call,
 * not a view dump, so it must not inherit the full capture timeout; both front
 * ends share this value so they cannot drift apart again.
 */
export declare const DEFAULT_STATE_JDWP_TIMEOUT_MS = 8000;
export interface CaptureStateOptions {
    /** Package to report; defaults to the foreground app. */
    packageName?: string;
    /** Attach to this pid instead of the package's first process. */
    pid?: number;
    /** JDWP request timeout for the window probe (default 8000ms). */
    requestTimeoutMs?: number;
}
export interface CaptureStateResult {
    device: DeviceInfo;
    screen: ScreenInfo;
    foreground: ForegroundApp;
    /** Resolved package (explicit option or foreground app), if any. */
    package: string | null;
    /** Pids of the resolved package; `[pid]` when only an explicit pid was given. */
    pids: number[];
    /**
     * ViewRootImpl windows reported over JDWP. Empty when there is no process to
     * attach to; `{ error }` when the app is running but JDWP failed (usually not
     * debuggable), which is expected rather than fatal for a status call.
     */
    windows: WindowInfo[] | {
        error: string;
    };
}
export interface ReadWindowsOptions {
    /** Package whose first process is probed when no pid is given. */
    packageName?: string;
    /** Probe this pid instead of the package's first process. */
    pid?: number;
    /** JDWP request timeout for the window probe (default 8000ms). */
    requestTimeoutMs?: number;
}
export interface ReadWindowsResult {
    /** Process that was probed, or `null` when no process could be resolved. */
    pid: number | null;
    /** Window list on success; `{ error }` when JDWP failed (usually not debuggable). */
    windows: WindowInfo[] | {
        error: string;
    };
    /**
     * The original JDWP error, kept so a caller that wants to fail can rethrow it
     * and keep its `code` and `hint` instead of flattening it into a message.
     */
    error?: unknown;
}
/**
 * Resolve a pid, probe its ViewRootImpl windows over JDWP, and close the
 * connection. This is the body of the CLI `windows` command (which only needs
 * the pid, not screen or foreground data) and of `captureState`.
 */
export declare function readWindows(adb: Adb, options?: ReadWindowsOptions): Promise<ReadWindowsResult>;
/**
 * Device, screen, foreground app, pids, and JDWP windows in one call. This is
 * the shared body of the CLI `state` command and the MCP `get_state` tool.
 */
export declare function captureState(adb: Adb, options?: CaptureStateOptions): Promise<CaptureStateResult>;
