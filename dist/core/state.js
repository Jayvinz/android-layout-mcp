import { errorMessage } from "./errors.js";
import { JdwpClient } from "./jdwp.js";
/**
 * One timeout for the short JDWP window probe. `state` is a cheap status call,
 * not a view dump, so it must not inherit the full capture timeout; both front
 * ends share this value so they cannot drift apart again.
 */
export const DEFAULT_STATE_JDWP_TIMEOUT_MS = 8000;
/**
 * Resolve a pid, probe its ViewRootImpl windows over JDWP, and close the
 * connection. This is the body of the CLI `windows` command (which only needs
 * the pid, not screen or foreground data) and of `captureState`.
 */
export async function readWindows(adb, options = {}) {
    // Pid resolution stays outside the try: an adb failure there is a real error
    // (the device went away), not the expected "app is not debuggable" sentinel.
    const pid = options.pid ??
        (options.packageName ? (await adb.packagePids(options.packageName))[0] ?? null : null);
    if (pid === null)
        return { pid, windows: [] };
    try {
        const client = await JdwpClient.open(adb, pid, {
            requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_STATE_JDWP_TIMEOUT_MS,
        });
        try {
            return { pid, windows: await client.listWindows() };
        }
        finally {
            await client.close();
        }
    }
    catch (error) {
        return { pid, windows: { error: errorMessage(error) }, error };
    }
}
/**
 * Device, screen, foreground app, pids, and JDWP windows in one call. This is
 * the shared body of the CLI `state` command and the MCP `get_state` tool.
 */
export async function captureState(adb, options = {}) {
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
