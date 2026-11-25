import { AuiError } from "./errors.js";
import { allFragments, notableFragments, parseDumpsys, } from "./dumpsys.js";
/** Projects a parsed fragment onto the shared, front-end-neutral field set. */
export function toFragmentSummary(fragment) {
    return {
        className: fragment.className,
        shortClassName: fragment.shortClassName,
        tag: fragment.tag,
        state: fragment.state,
        added: fragment.added,
        hidden: fragment.hidden,
        detached: fragment.detached,
        containerId: fragment.containerId,
        activity: fragment.activity,
    };
}
/**
 * Projects an already-parsed `dumpsys activity` dump onto the shared shape.
 * `capture(source=dumpsys)` reuses the parse it needs for the view tree, so it
 * calls this instead of running `dumpsys` a second time through readFragments.
 */
export function fragmentsFromDump(parsed, options = {}) {
    const keep = (fragment) => options.includeFramework ? true : notableFragments([fragment]).length > 0;
    return {
        activities: parsed.activities.map((activity) => ({
            activity: activity.activity,
            pid: activity.pid,
            fragments: activity.fragments.filter(keep).map(toFragmentSummary),
        })),
        fragments: (options.includeFramework
            ? allFragments(parsed)
            : notableFragments(allFragments(parsed))).map(toFragmentSummary),
    };
}
/**
 * Reads the Activity/Fragment structure of a package from `dumpsys activity`.
 * Works on non-debuggable apps, where the ViewDebug source fails. This is the
 * shared body of the CLI `fragments` command and the MCP `list_fragments` tool;
 * `capture(source=dumpsys)` reuses the same projection via fragmentsFromDump.
 */
export async function readFragments(adb, options = {}) {
    const packageName = options.packageName ?? (await adb.foregroundApp()).packageName;
    if (!packageName) {
        throw new AuiError("BAD_INPUT", "Could not determine the foreground app package.");
    }
    const output = await adb.shell(`dumpsys activity ${packageName}`, {
        timeoutMs: options.timeoutMs ?? 30_000,
    });
    const parsed = parseDumpsys(output, { packageName });
    return { package: packageName, ...fragmentsFromDump(parsed, options) };
}
