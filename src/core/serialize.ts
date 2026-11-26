import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CaptureResult, DumpFile, UiNode } from "./model.js";
import { serializeNode } from "./viewdump.js";

export function serializeDump(result: CaptureResult, includeProperties = true): DumpFile {
  const roots = (nodes: UiNode[]) =>
    nodes.map((node) => serializeNode(node, { includeProps: includeProperties })) as unknown as UiNode[];
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
            // A multi-window capture lists every tree under `windows`; the
            // primary is marked selected, so `roots` is not duplicated here.
            ...(result.view.windows
              ? {
                  windows: result.view.windows.map((window) => ({
                    name: window.name,
                    ...(window.selected ? { selected: true } : {}),
                    roots: roots(window.roots),
                  })),
                }
              : { roots: roots(result.view.roots) }),
          },
        }
      : {}),
    ...(result.semantics
      ? {
          semantics: {
            rotation: result.semantics.rotation,
            captureMs: result.semantics.captureMs,
            roots: roots(result.semantics.roots),
          },
        }
      : {}),
    ...(result.dumpsys
      ? {
          dumpsys: {
            activity: result.dumpsys.activity,
            captureMs: result.dumpsys.captureMs,
            fragments: result.dumpsys.fragments.map((fragment) => ({ ...fragment })),
            labelledNodes: result.dumpsys.labelledNodes,
            roots: result.dumpsys.roots.map((node) =>
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
    ...(result.stability ? { stability: result.stability } : {}),
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
