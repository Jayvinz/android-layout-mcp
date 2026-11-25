import type { Adb } from "./adb.js";
import { AlmError } from "./errors.js";
import {
  allFragments,
  notableFragments,
  parseDumpsys,
  type DumpsysParseResult,
  type FragmentInfo,
} from "./dumpsys.js";
import type { FragmentSummary } from "./model.js";

/**
 * The fragment field set reported by every front end (`FragmentSummary` in
 * model.ts). It is a projection of `FragmentInfo`: the instance discriminator
 * (`raw`), ids, and back-stack nesting stay internal so the CLI and MCP cannot
 * report different shapes.
 */
export interface FragmentActivity {
  activity: string;
  pid: number | null;
  fragments: FragmentSummary[];
}

export interface ReadFragmentsResult {
  package: string;
  activities: FragmentActivity[];
  /** Flattened fragments across all activities, framework ones filtered by default. */
  fragments: FragmentSummary[];
}

export interface ReadFragmentsOptions {
  /** Package to inspect; defaults to the foreground app. */
  packageName?: string;
  /** Keep AndroidX lifecycle bookkeeping fragments (ReportFragment etc.). */
  includeFramework?: boolean;
  /** Timeout for the `dumpsys activity` shell call (default 30000ms). */
  timeoutMs?: number;
}

/** Projects a parsed fragment onto the shared, front-end-neutral field set. */
export function toFragmentSummary(fragment: FragmentInfo): FragmentSummary {
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
export function fragmentsFromDump(
  parsed: DumpsysParseResult,
  options: { includeFramework?: boolean } = {},
): { activities: FragmentActivity[]; fragments: FragmentSummary[] } {
  const keep = (fragment: FragmentInfo) =>
    options.includeFramework ? true : notableFragments([fragment]).length > 0;
  return {
    activities: parsed.activities.map((activity) => ({
      activity: activity.activity,
      pid: activity.pid,
      fragments: activity.fragments.filter(keep).map(toFragmentSummary),
    })),
    fragments: (options.includeFramework
      ? allFragments(parsed)
      : notableFragments(allFragments(parsed))
    ).map(toFragmentSummary),
  };
}

/**
 * Reads the Activity/Fragment structure of a package from `dumpsys activity`.
 * Works on non-debuggable apps, where the ViewDebug source fails. This is the
 * shared body of the CLI `fragments` command and the MCP `list_fragments` tool;
 * `capture(source=dumpsys)` reuses the same projection via fragmentsFromDump.
 */
export async function readFragments(
  adb: Adb,
  options: ReadFragmentsOptions = {},
): Promise<ReadFragmentsResult> {
  const packageName = options.packageName ?? (await adb.foregroundApp()).packageName;
  if (!packageName) {
    throw new AlmError("BAD_INPUT", "Could not determine the foreground app package.");
  }
  const output = await adb.shell(`dumpsys activity ${packageName}`, {
    timeoutMs: options.timeoutMs ?? 30_000,
  });
  const parsed = parseDumpsys(output, { packageName });
  return { package: packageName, ...fragmentsFromDump(parsed, options) };
}
