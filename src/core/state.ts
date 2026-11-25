import type { Adb } from "./adb.js";
import { errorMessage } from "./errors.js";
import { JdwpClient } from "./jdwp.js";
import type { DeviceInfo, ForegroundApp, ScreenInfo, WindowInfo } from "./model.js";

/**
 * One timeout for the short JDWP window probe. `state` is a cheap status call,
 * not a view dump, so it must not inherit the full capture timeout; both front
 * ends share this value so they cannot drift apart again.
 */
export const DEFAULT_STATE_JDWP_TIMEOUT_MS = 8000;

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
  windows: WindowInfo[] | { error: string };
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
  windows: WindowInfo[] | { error: string };
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
export async function readWindows(adb: Adb, options: ReadWindowsOptions = {}): Promise<ReadWindowsResult> {
  // Pid resolution stays outside the try: an adb failure there is a real error
  // (the device went away), not the expected "app is not debuggable" sentinel.
  const pid =
    options.pid ??
    (options.packageName ? (await adb.packagePids(options.packageName))[0] ?? null : null);
  if (pid === null) return { pid, windows: [] };

  try {
    const client = await JdwpClient.open(adb, pid, {
      requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_STATE_JDWP_TIMEOUT_MS,
    });
    try {
      return { pid, windows: await client.listWindows() };
    } finally {
      await client.close();
    }
  } catch (error) {
    return { pid, windows: { error: errorMessage(error) }, error };
  }
}

/**
 * Device, screen, foreground app, pids, and JDWP windows in one call. This is
 * the shared body of the CLI `state` command and the MCP `get_state` tool.
 */
export async function captureState(
  adb: Adb,
  options: CaptureStateOptions = {},
): Promise<CaptureStateResult> {
  const device = await adb.resolveDevice();
  const [screen, foreground] = await Promise.all([adb.screenInfo(), adb.foregroundApp()]);
  const packageName = options.packageName || foreground.packageName;
  const pids = packageName
    ? await adb.packagePids(packageName)
    : options.pid !== undefined
      ? [options.pid]
      : [];
  const targetPid = options.pid ?? pids[0] ?? null;
  // Pass the resolved pid so the probe cannot resolve the process a second time.
  const { windows } = await readWindows(adb, {
    pid: targetPid ?? undefined,
    requestTimeoutMs: options.requestTimeoutMs,
  });

  return { device, screen, foreground, package: packageName, pids, windows };
}
