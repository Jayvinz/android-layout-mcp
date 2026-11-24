import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CaptureResult, DumpFile, NodeSource, UiNode } from "./model.js";
import type { SnapshotNode } from "./diff.js";
import { serializeNode } from "./viewdump.js";

export function serializeDump(result: CaptureResult, includeProperties = true): DumpFile {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    device: result.device,
    target: filterTarget(result.target),
    screen: result.screen,
    source: result.source,
    sources: result.sources,
    uiKind: result.uiKind,
    ...(result.view
      ? {
          view: {
            window: result.view.window,
            captureMs: result.view.captureMs,
            roots: result.view.roots.map((node) =>
              serializeNode(node, { includeProps: includeProperties }),
            ) as unknown as UiNode[],
          },
        }
      : {}),
    ...(result.semantics
      ? {
          semantics: {
            rotation: result.semantics.rotation,
            captureMs: result.semantics.captureMs,
            roots: result.semantics.roots.map((node) =>
              serializeNode(node, { includeProps: includeProperties }),
            ) as unknown as UiNode[],
          },
        }
      : {}),
    ...(result.compose
      ? {
          compose: {
            rootViewId: result.compose.rootViewId,
            captureMs: result.compose.captureMs,
            roots: result.compose.roots.map((node) =>
              serializeNode(node, { includeProps: includeProperties }),
            ) as unknown as UiNode[],
          },
        }
      : {}),
    warnings: result.warnings,
  };
}

function filterTarget(target: CaptureResult["target"]): CaptureResult["target"] {
  return {
    ...target,
    windows: target.windows?.map((window) => ({ ...window })),
  };
}

export async function saveDump(result: CaptureResult, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(serializeDump(result), null, 2)}\n`, "utf8");
}

export async function loadDump(path: string): Promise<DumpFile> {
  const text = await readFile(path, "utf8");
  const parsed = JSON.parse(text) as DumpFile;
  if (!parsed || typeof parsed !== "object" || parsed.version !== 1) {
    throw new Error(`${path} is not an android-layout dump (version 1).`);
  }
  return parsed;
}

/** Returns the roots of the requested (or primary) source as diffable nodes. */
export function snapshotRoots(dump: DumpFile, source?: NodeSource): SnapshotNode[] {
  const chosen = source ?? dump.source;
  const tree =
    chosen === "semantics" ? dump.semantics?.roots : chosen === "compose" ? dump.compose?.roots : dump.view?.roots;
  if (tree) return tree as unknown as SnapshotNode[];
  const fallback =
    chosen === "semantics"
      ? dump.view?.roots
      : chosen === "compose"
        ? dump.view?.roots
        : dump.semantics?.roots;
  return (fallback ?? []) as unknown as SnapshotNode[];
}

/**
 * Choose a source that exists in both dumps. Dumps captured with different
 * primary sources (e.g. source=both vs auto) would otherwise be compared
 * across trees, producing nonsense diffs.
 */
export function chooseDiffSource(
  before: DumpFile,
  after: DumpFile,
  explicit?: NodeSource,
): NodeSource {
  if (explicit) return explicit;
  const has = (dump: DumpFile, source: NodeSource) =>
    source === "view"
      ? Boolean(dump.view)
      : source === "semantics"
        ? Boolean(dump.semantics)
        : Boolean(dump.compose);
  if (before.source === after.source) return before.source;
  if (has(before, "compose") && has(after, "compose")) return "compose";
  if (has(before, "semantics") && has(after, "semantics")) return "semantics";
  if (has(before, "view") && has(after, "view")) return "view";
  return before.source;
}
