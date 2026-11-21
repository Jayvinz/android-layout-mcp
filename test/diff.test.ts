import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { diffSnapshots, renderDiff, type SnapshotNode } from "../src/core/diff.js";
import { pngSize } from "../src/core/screenshot.js";

function node(partial: Partial<SnapshotNode> & Pick<SnapshotNode, "ref">): SnapshotNode {
  return {
    id: partial.id ?? partial.ref,
    ref: partial.ref,
    source: partial.source ?? "semantics",
    className: partial.className ?? "android.view.View",
    resourceId: partial.resourceId ?? null,
    text: partial.text ?? null,
    contentDescription: partial.contentDescription ?? null,
    bounds: partial.bounds ?? { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 },
    visibleBounds: partial.visibleBounds ?? partial.bounds ?? { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 },
    clickable: partial.clickable ?? false,
    children: partial.children ?? [],
  };
}

test("diff detects added, removed and moved nodes", () => {
  const before = [
    node({
      ref: "s0",
      className: "FrameLayout",
      children: [
        node({ ref: "s1", text: "Old", bounds: { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 } }),
      ],
    }),
  ];
  const after = [
    node({
      ref: "s0",
      className: "FrameLayout",
      children: [
        node({ ref: "s2", text: "Old", bounds: { left: 20, top: 10, right: 140, bottom: 110, width: 120, height: 100 } }),
        node({ ref: "s3", text: "New" }),
      ],
    }),
  ];
  const diff = diffSnapshots(before, after);
  assert.deepEqual(diff.summary, { added: 1, removed: 0, changed: 1 });
  assert.equal(diff.added[0].label, 'android.view.View "New"');
  assert.match(diff.changed[0].changes[0], /bounds/);
  assert.match(renderDiff(diff), /\+ android\.view\.View "New"/);
});

test("reads PNG dimensions for screenshots", () => {
  const png = readFileSync(new URL("./fixtures/screenshot.png", import.meta.url));
  assert.deepEqual(pngSize(png), { width: 1080, height: 2400 });
});
