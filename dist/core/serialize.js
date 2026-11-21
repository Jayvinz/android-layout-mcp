import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { serializeNode } from "./viewdump.js";
export function serializeDump(result, includeProperties = true) {
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
                    roots: result.view.roots.map((node) => serializeNode(node, { includeProps: includeProperties })),
                },
            }
            : {}),
        ...(result.semantics
            ? {
                semantics: {
                    rotation: result.semantics.rotation,
                    captureMs: result.semantics.captureMs,
                    roots: result.semantics.roots.map((node) => serializeNode(node, { includeProps: includeProperties })),
                },
            }
            : {}),
        ...(result.compose
            ? {
                compose: {
                    rootViewId: result.compose.rootViewId,
                    captureMs: result.compose.captureMs,
                    roots: result.compose.roots.map((node) => serializeNode(node, { includeProps: includeProperties })),
                },
            }
            : {}),
        warnings: result.warnings,
    };
}
function filterTarget(target) {
    return {
        ...target,
        windows: target.windows?.map((window) => ({ ...window })),
    };
}
export async function saveDump(result, path) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(serializeDump(result), null, 2)}\n`, "utf8");
}
export async function loadDump(path) {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || parsed.version !== 1) {
        throw new Error(`${path} is not a layout-inspector-android dump (version 1).`);
    }
    return parsed;
}
/** Returns the roots of the requested (or primary) source as diffable nodes. */
export function snapshotRoots(dump, source) {
    const chosen = source ?? dump.source;
    const tree = chosen === "semantics" ? dump.semantics?.roots : chosen === "compose" ? dump.compose?.roots : dump.view?.roots;
    if (tree)
        return tree;
    const fallback = chosen === "semantics"
        ? dump.view?.roots
        : chosen === "compose"
            ? dump.view?.roots
            : dump.semantics?.roots;
    return (fallback ?? []);
}
/**
 * Choose a source that exists in both dumps. Dumps captured with different
 * primary sources (e.g. source=both vs auto) would otherwise be compared
 * across trees, producing nonsense diffs.
 */
export function chooseDiffSource(before, after, explicit) {
    if (explicit)
        return explicit;
    const has = (dump, source) => source === "view"
        ? Boolean(dump.view)
        : source === "semantics"
            ? Boolean(dump.semantics)
            : Boolean(dump.compose);
    if (before.source === after.source)
        return before.source;
    if (has(before, "compose") && has(after, "compose"))
        return "compose";
    if (has(before, "semantics") && has(after, "semantics"))
        return "semantics";
    if (has(before, "view") && has(after, "view"))
        return "view";
    return before.source;
}
