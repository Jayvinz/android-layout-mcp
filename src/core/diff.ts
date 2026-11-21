import type { Bounds, NodeSource } from "./model.js";

/** Minimal node shape from a serialised dump file. */
export interface SnapshotNode {
  id: string;
  ref: string;
  source: NodeSource;
  className: string;
  resourceId: string | null;
  text: string | null;
  contentDescription: string | null;
  bounds: Bounds;
  visibleBounds: Bounds | null;
  clickable?: boolean;
  children: SnapshotNode[];
}

export interface DiffEntry {
  kind: "added" | "removed" | "changed";
  key: string;
  source: NodeSource;
  label: string;
  before: SnapshotNode | null;
  after: SnapshotNode | null;
  changes: string[];
}

export interface DiffResult {
  added: DiffEntry[];
  removed: DiffEntry[];
  changed: DiffEntry[];
  summary: { added: number; removed: number; changed: number };
}

export interface DiffOptions {
  source?: NodeSource;
  boundsTolerance?: number;
}

export function diffSnapshots(
  before: SnapshotNode[],
  after: SnapshotNode[],
  options: DiffOptions = {},
): DiffResult {
  const tolerance = options.boundsTolerance ?? 1;
  const mapBefore = indexNodes(before, options.source);
  const mapAfter = indexNodes(after, options.source);
  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];
  const changed: DiffEntry[] = [];

  for (const [key, entries] of mapAfter) {
    const beforeEntries = mapBefore.get(key) ?? [];
    const paired = Math.min(entries.length, beforeEntries.length);
    for (let i = 0; i < entries.length; i++) {
      if (i < paired) {
        const oldNode = beforeEntries[i];
        const newNode = entries[i];
        const changes = boundsChanges(oldNode, newNode, tolerance);
        if (changes.length > 0) {
          changed.push({
            kind: "changed",
            key,
            source: newNode.source,
            label: label(newNode),
            before: oldNode,
            after: newNode,
            changes,
          });
        }
      } else {
        added.push({
          kind: "added",
          key,
          source: entries[i].source,
          label: label(entries[i]),
          before: null,
          after: entries[i],
          changes: [],
        });
      }
    }
    if (beforeEntries.length > entries.length) {
      for (let i = entries.length; i < beforeEntries.length; i++) {
        removed.push({
          kind: "removed",
          key,
          source: beforeEntries[i].source,
          label: label(beforeEntries[i]),
          before: beforeEntries[i],
          after: null,
          changes: [],
        });
      }
    }
  }
  for (const [key, entries] of mapBefore) {
    if (!mapAfter.has(key)) {
      for (const entry of entries) {
        removed.push({
          kind: "removed",
          key,
          source: entry.source,
          label: label(entry),
          before: entry,
          after: null,
          changes: [],
        });
      }
    }
  }

  return {
    added,
    removed,
    changed,
    summary: { added: added.length, removed: removed.length, changed: changed.length },
  };
}

function indexNodes(roots: SnapshotNode[], source?: NodeSource): Map<string, SnapshotNode[]> {
  const result = new Map<string, SnapshotNode[]>();
  const walk = (node: SnapshotNode, parentSignature: string, index: number) => {
    if (source && node.source !== source) {
      // Still walk children from the other source? No: each dump has both trees
      // side by side; only index the requested source.
      return;
    }
    const key = [
      node.className,
      node.resourceId ?? "",
      node.text ?? "",
      node.contentDescription ?? "",
      parentSignature,
      index,
    ].join("\u0001");
    const list = result.get(key) ?? [];
    list.push(node);
    result.set(key, list);
    const signature = `${parentSignature}/${node.className}#${index}`;
    node.children.forEach((child, childIndex) => walk(child, signature, childIndex));
  };
  roots.forEach((root, index) => walk(root, "", index));
  return result;
}

function boundsChanges(before: SnapshotNode, after: SnapshotNode, tolerance: number): string[] {
  const changes: string[] = [];
  const old = before.bounds;
  const next = after.bounds;
  if (
    Math.abs(old.left - next.left) > tolerance ||
    Math.abs(old.top - next.top) > tolerance ||
    Math.abs(old.width - next.width) > tolerance ||
    Math.abs(old.height - next.height) > tolerance
  ) {
    changes.push(
      `bounds ${formatBounds(old)} -> ${formatBounds(next)} (dx=${next.left - old.left}, dy=${next.top - old.top}, dw=${next.width - old.width}, dh=${next.height - old.height})`,
    );
  }
  if (before.visibleBounds && !after.visibleBounds) changes.push("became clipped/hidden");
  if (!before.visibleBounds && after.visibleBounds) changes.push("became visible");
  return changes;
}

function formatBounds(bounds: Bounds): string {
  return `[${bounds.left},${bounds.top}][${bounds.right},${bounds.bottom}]`;
}

function label(node: SnapshotNode): string {
  const text = node.text || node.contentDescription;
  return `${node.className}${text ? ` "${text.slice(0, 50)}"` : ""}`;
}

export function renderDiff(result: DiffResult): string {
  const lines: string[] = [];
  lines.push(
    `layout diff: ${result.summary.added} added, ${result.summary.removed} removed, ${result.summary.changed} changed`,
  );
  for (const entry of result.removed) {
    lines.push(`- ${entry.label} ${formatBounds(entry.before!.bounds)}`);
  }
  for (const entry of result.added) {
    lines.push(`+ ${entry.label} ${formatBounds(entry.after!.bounds)}`);
  }
  for (const entry of result.changed) {
    lines.push(`~ ${entry.label}: ${entry.changes.join("; ")}`);
  }
  return lines.join("\n");
}
