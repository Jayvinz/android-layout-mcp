import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CaptureResult, DumpFile, NodeSource, UiNode } from "./model.js";
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
