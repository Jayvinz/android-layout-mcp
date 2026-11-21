import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { buildComposeRoots, type HelperRoot } from "../src/core/compose.js";
import { flattenNodes, assignRefs } from "../src/core/viewdump.js";
import { findNodes, hitTest } from "../src/core/query.js";
import { renderCapture } from "../src/core/render.js";
import { analyzeCapture } from "../src/core/analyze.js";
import { serializeDump } from "../src/core/serialize.js";
import type { CaptureResult, ScreenInfo } from "../src/core/model.js";

const screen: ScreenInfo = {
  width: 1080,
  height: 2400,
  density: 2.75,
  densityDpi: 440,
  orientation: "portrait",
  rotation: 0,
};

const helper = JSON.parse(
  readFileSync(new URL("./fixtures/compose-tree.json", import.meta.url), "utf8"),
) as { ok: boolean; roots: HelperRoot[] };

function capture(): CaptureResult {
  const roots = buildComposeRoots(helper.roots, "com.example.droidreel.debug");
  assignRefs(roots, "c");
  return {
    device: {
      serial: "fixture",
      state: "device",
      model: "Fixture",
      product: null,
      device: null,
      transportId: null,
      manufacturer: "Test",
      androidRelease: "13",
      sdk: 33,
    },
    target: {
      serial: "fixture",
      packageName: "com.example.droidreel.debug",
      pid: 1234,
      activity: "CommunityActivity",
      debuggable: true,
      windows: [],
    },
    screen,
    source: "compose",
    sources: ["compose"],
    uiKind: "compose",
    compose: { rootViewId: 13, roots, captureMs: 8000 },
    warnings: [],
  };
}

test("builds a Compose tree from the JVMTI helper output", () => {
  const result = capture();
  const nodes = flattenNodes(result.compose!.roots);
  assert.equal(nodes.length, 489);
  const root = nodes[0];
  assert.equal(root.source, "compose");
  assert.equal(root.compose?.name, "DroidReelTheme");
  assert.equal(root.compose?.fileName, "CommunityActivity.kt");
  assert.equal(root.compose?.lineNumber, 85);
  assert.equal(root.bounds.width, 1080);
  assert.equal(root.bounds.height, 2276);
  assert.equal(root.ref, "c0");
});

test("find and hit-test work on Compose nodes", () => {
  const roots = capture().compose!.roots;
  const textNodes = findNodes(roots, { query: "Text", by: "class", match: "exact" });
  assert.ok(textNodes.length >= 1);
  assert.equal(textNodes[0].node.source, "compose");
  const hit = hitTest(roots, 540, 2239);
  assert.ok(hit.primary);
  assert.equal(hit.primary.source, "compose");
  assert.ok(hit.primary.bounds.width > 0);
  assert.ok(hit.candidates.length > 1);
});

test("renders Compose source/line information", () => {
  const text = renderCapture(capture(), "compose", { depth: 2 });
  assert.match(text, /primary source: compose/);
  assert.match(text, /DroidReelTheme CommunityActivity\.kt:85/);
  assert.match(text, /compose root view id=13/);
});

test("maps Compose parameter text and content descriptions", () => {
  const roots = buildComposeRoots(
    [
      {
        viewId: 1,
        nodes: [
          {
            id: "42",
            name: "Text",
            fileName: "Screen.kt",
            lineNumber: 12,
            offset: 10,
            anchorHash: 7,
            recomposeCount: 3,
            recomposeSkips: 1,
            flags: ["HAS_MERGED_SEMANTICS"],
            text: "推荐",
            contentDescription: "推荐标签",
            bounds: { left: 10, top: 20, width: 100, height: 50 },
            children: [],
          },
        ],
      },
    ],
    "com.example.demo",
  );
  assignRefs(roots, "c");
  assert.equal(roots[0].text, "推荐");
  assert.equal(roots[0].contentDescription, "推荐标签");
  assert.equal(roots[0].compose?.recomposeCount, 3);
  const matches = findNodes(roots, { query: "推荐", by: "text" });
  assert.equal(matches.length, 1);
  const text = renderCapture(
    {
      ...capture(),
      compose: { rootViewId: 1, roots, captureMs: 1 },
    },
    "compose",
    { depth: 1 },
  );
  assert.match(text, /"推荐"/);
});

test("analysis and serialisation include Compose nodes", () => {
  const result = capture();
  const analysis = analyzeCapture(result);
  assert.equal(analysis.nodeCount, 489);
  const dump = serializeDump(result, false);
  assert.ok(dump.compose);
  assert.equal(dump.compose!.rootViewId, 13);
  assert.equal(dump.sources[0], "compose");
});