import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import type { UiNode } from "../src/core/model.js";
import {
  buildCompactPayload,
  compactTree,
  flattenCompactTree,
  isMeaningfulNode,
} from "../src/core/prune.js";
import { flattenNodes, parseViewHierarchy } from "../src/core/viewdump.js";
import { box, loadFixtureCapture, makeTestNode, SCREEN } from "./fixtures.js";

function textNode(text: string, overrides: Partial<UiNode> = {}): UiNode {
  return makeTestNode({
    className: "android.widget.TextView",
    shortClassName: "TextView",
    text,
    ...overrides,
  });
}

test("promotes the children of a dropped container to its parent", () => {
  const root = makeTestNode({ children: [textNode("登录")] });
  const pruned = compactTree([root]);
  assert.equal(pruned.total, 2);
  assert.equal(pruned.kept, 1);
  assert.equal(pruned.nodes.length, 1);
  assert.equal(pruned.nodes[0].text, "登录");
});

test("drops unlabeled nodes that neither say nor do anything", () => {
  const root = makeTestNode({
    children: [makeTestNode({ className: "android.view.View", shortClassName: "View" }), textNode("设置")],
  });
  const pruned = compactTree([root]);
  assert.deepEqual(pruned.nodes.map((node) => node.text), ["设置"]);
});

test("keeps an unlabeled clickable node and tags it", () => {
  const button = makeTestNode({
    className: "android.view.View",
    shortClassName: "View",
    clickable: true,
  });
  const pruned = compactTree([button]);
  assert.equal(pruned.nodes.length, 1);
  assert.deepEqual(pruned.nodes[0].flags, ["click"]);
  assert.equal(pruned.nodes[0].class, "View");
});

test("drops invisible nodes by default and keeps them tagged when asked", () => {
  const hidden = textNode("隐藏", { visible: false, visibleBounds: null });
  assert.equal(compactTree([hidden]).kept, 0);

  const kept = compactTree([hidden], { includeInvisible: true });
  assert.equal(kept.kept, 1);
  assert.ok(kept.nodes[0].flags?.includes("hidden"));
});

test("kept children carry compact fields only", () => {
  const node = makeTestNode({
    className: "android.widget.Button",
    shortClassName: "Button",
    resourceId: "com.example:id/submit",
    contentDescription: "提交表单",
    enabled: false,
    clickable: true,
    selected: true,
  });
  const compact = compactTree([node]).nodes[0];
  assert.equal(compact.ref, node.ref);
  assert.equal(compact.id, "com.example:id/submit");
  assert.equal(compact.desc, "提交表单");
  assert.equal(compact.bounds, "[0,0][100,100]");
  assert.deepEqual(compact.center, [50, 50]);
  assert.deepEqual(compact.flags, ["click", "selected", "disabled"]);
  // Heavy per-node defaults are gone: no bounds object, no visible/clickable booleans.
  assert.equal("visible" in compact, false);
  assert.equal("clickable" in compact, false);
});

test("flat output keeps depth so the hierarchy stays recoverable", () => {
  const card = makeTestNode({
    clickable: true,
    children: [textNode("Wi-Fi", { center: { x: 20, y: 20 } })],
  });
  const pruned = compactTree([card]);
  const flat = flattenCompactTree(pruned.nodes);
  assert.equal(flat.length, 2);
  assert.equal(flat[0].depth, 0);
  assert.equal(flat[1].depth, 1);
  assert.equal(flat[1].text, "Wi-Fi");
  assert.equal("children" in flat[0], false);
});

test("maxNodes truncates and reports it", () => {
  const root = makeTestNode({ children: [textNode("一"), textNode("二"), textNode("三")] });
  const pruned = compactTree([root], { maxNodes: 2 });
  assert.equal(pruned.kept, 2);
  assert.equal(pruned.truncated, true);
});

test("maxDepth cuts deeper kept nodes", () => {
  const deep = makeTestNode({
    clickable: true,
    children: [makeTestNode({ clickable: true, children: [textNode("深")] })],
  });
  // maxDepth=1 matches dump_ui.depth: depth 0 and 1 are kept, deeper is cut.
  const cut = compactTree([deep], { maxDepth: 1 });
  assert.equal(cut.kept, 2);
  assert.equal(cut.truncated, true);
  const rootOnly = compactTree([deep], { maxDepth: 0 });
  assert.equal(rootOnly.kept, 1);
  assert.equal(rootOnly.truncated, true);
  // A leaf at the depth limit is kept without reporting a cut.
  assert.equal(compactTree([makeTestNode({ clickable: true, children: [textNode("x")] })], { maxDepth: 1 }).truncated, false);
});

test("meaningfulness is content or interaction, not structure", () => {
  assert.equal(isMeaningfulNode(makeTestNode()), false);
  assert.equal(isMeaningfulNode(textNode("x")), true);
  assert.equal(isMeaningfulNode(makeTestNode({ enabled: false })), true);
  assert.equal(isMeaningfulNode(makeTestNode({ checkable: true, checked: true })), true);
});

test("prunes the Compose semantics fixture without losing its text", () => {
  const capture = loadFixtureCapture();
  const semanticsRoots = capture.semantics!.roots;
  const pruned = compactTree(semanticsRoots);
  assert.ok(pruned.total > pruned.kept, "a compact tree should drop scaffolding");
  assert.ok(pruned.kept > 0);
  for (const node of flattenCompactTree(pruned.nodes)) {
    assert.match(node.bounds, /^\[-?\d+,-?\d+\]\[-?\d+,-?\d+\]$/);
    assert.equal(typeof node.center[0], "number");
    assert.equal("visibleBounds" in node, false);
  }
  const texts = flattenCompactTree(pruned.nodes).flatMap((node) => (node.text ? [node.text] : []));
  assert.ok(texts.includes("开拍"), "visible text must survive the projection");
});

test("prunes the XML view fixture and reports stats in the payload", () => {
  const roots = parseViewHierarchy(
    readFileSync(new URL("./fixtures/hierarchy-xml-v2.bin", import.meta.url)),
    { screen: SCREEN, packageName: "com.example.droidreel.debug" },
  );
  const total = flattenNodes(roots).length;
  const pruned = compactTree(roots);
  assert.equal(pruned.total, total);
  assert.ok(pruned.kept > 0 && pruned.kept < total, `${pruned.kept}/${total} kept`);

  const capture = loadFixtureCapture();
  const payload = buildCompactPayload(capture, { format: "flat", maxNodes: 50 });
  const stats = payload.stats as { nodes: number; kept: number; dropped: number; truncated: boolean };
  assert.equal(stats.kept, stats.nodes - stats.dropped);
  assert.equal(payload.format, "flat");
  assert.match(String(payload.hint), /format=json/);
  const nodes = (payload.semantics as { nodes: Array<Record<string, unknown>> }).nodes;
  assert.ok(nodes.length > 0);
  assert.equal(typeof nodes[0].depth, "number");
});
test("explains a compact tree that keeps nothing", () => {
  // A Compose screen's ViewDebug tree stops at AndroidComposeView and has no
  // text or interaction, so compact legitimately keeps zero nodes.
  const capture = loadFixtureCapture();
  const viewOnly = {
    ...capture,
    semantics: undefined,
    view: {
      window: "Compose",
      captureMs: 5,
      roots: [makeTestNode({ className: "androidx.compose.ui.platform.AndroidComposeView", shortClassName: "AndroidComposeView" })],
    },
  };
  const payload = buildCompactPayload(viewOnly, { format: "compact" });
  assert.equal((payload.stats as { kept: number }).kept, 0);
  assert.match(String(payload.hint), /compact kept 0 of 1 nodes/);
  assert.match(String(payload.hint), /source=semantics/);
});
