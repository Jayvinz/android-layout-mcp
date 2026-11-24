import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { loadFixtureCapture } from "./fixtures.js";
import {
  defaultViewerPath,
  openInBrowser,
  renderViewerHtml,
  renderViewerHtmlFromPayload,
  viewerPayload,
  type ViewerPayload,
} from "../src/core/viewer.js";
import { pngSize, type Screenshot } from "../src/core/screenshot.js";
import { flattenNodes } from "../src/core/viewdump.js";
import { findNodes } from "../src/core/query.js";

const capture = loadFixtureCapture();
const png = readFileSync(new URL("./fixtures/screenshot.png", import.meta.url));
const pngDimensions = pngSize(png);
const screenshot: Screenshot = {
  buffer: png,
  width: pngDimensions.width,
  height: pngDimensions.height,
  originalWidth: pngDimensions.width,
  originalHeight: pngDimensions.height,
  scale: 1,
};
const createdAt = "2026-01-01T00:00:00.000Z";
const html = renderViewerHtml(capture, { screenshot, createdAt });

function serializedNodeCount(nodes: unknown[]): number {
  let count = 0;
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    count += 1;
    const children = (node as { children?: unknown[] }).children;
    if (Array.isArray(children)) for (const child of children) walk(child);
  };
  for (const node of nodes) walk(node);
  return count;
}

function hasTruncatedPlaceholder(nodes: unknown[]): boolean {
  const walk = (node: unknown): boolean => {
    if (!node || typeof node !== "object") return false;
    if ((node as { truncated?: boolean }).truncated === true) return true;
    const children = (node as { children?: unknown[] }).children;
    if (!Array.isArray(children)) return false;
    return children.some(walk);
  };
  return nodes.some(walk);
}

test("renders one self-contained document with fixture data and no external URLs", () => {
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.trimEnd().endsWith("</html>"));
  assert.ok(html.includes('<script id="aui-data" type="application/json">'));
  assert.ok(html.includes("data:image/png;base64,"));
  assert.ok(html.includes("Content-Security-Policy"));
  assert.ok(html.includes('connect-src \'none\''));
  assert.ok(html.includes("开拍"), "fixture text should be embedded");
  const create = findNodes(capture.semantics!.roots, { query: "开拍" })[0].node;
  assert.ok(html.includes(create.ref), "fixture node ref should be embedded");
  assert.ok(!/https?:\/\//i.test(html), "viewer must not reference external URLs");
});

test("embedded payload round-trips node counts and screenshot metadata", () => {
  const match = /<script id="aui-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match, "expected the embedded JSON block");
  const payload = JSON.parse(match[1]) as ViewerPayload;
  assert.equal(payload.meta.version, 1);
  assert.equal(payload.meta.createdAt, createdAt);
  assert.equal(payload.meta.primarySource, capture.source);
  assert.deepEqual(payload.meta.sources, capture.sources);

  const viewTree = payload.trees.view!;
  const viewTotal = flattenNodes(capture.view!.roots).length;
  assert.equal(viewTree.totalNodes, viewTotal);
  assert.equal(viewTree.nodeCount, viewTotal);
  assert.equal(viewTree.truncated, false);
  assert.equal(serializedNodeCount(viewTree.roots), viewTotal);
  const firstRoot = viewTree.roots[0] as { children: unknown[] };
  assert.ok(Array.isArray(firstRoot.children) && firstRoot.children.length > 0);

  const semanticsTree = payload.trees.semantics!;
  assert.equal(
    semanticsTree.nodeCount,
    flattenNodes(capture.semantics!.roots).length,
  );

  assert.equal(payload.screenshot!.width, pngDimensions.width);
  assert.equal(payload.screenshot!.height, pngDimensions.height);
  assert.deepEqual(payload.screenshot!.imageToDevice, { x: 1, y: 1 });
});

test("escapes captured script-closing text in the embedded JSON", () => {
  const risky = loadFixtureCapture();
  const evil = "</script><script>window.__xss=1</script>";
  const node = flattenNodes(risky.semantics!.roots).find((candidate) => candidate.text === "开拍");
  assert.ok(node, "fixture should contain the 开拍 node");
  node.text = evil;

  const riskyHtml = renderViewerHtml(risky, { screenshot: null });
  assert.ok(!riskyHtml.includes(evil), "raw script-closing sequence must not appear");
  assert.ok(
    riskyHtml.includes("\\u003c/script>\\u003cscript>window.__xss=1\\u003c/script>"),
    "angle brackets should be escaped as \\u003c",
  );
});

test("renders a tree-only viewer when the screenshot is missing", () => {
  const payload = viewerPayload(capture, { screenshot: null, createdAt });
  assert.equal(payload.screenshot, null);
  const treeOnlyHtml = renderViewerHtmlFromPayload(payload);
  assert.ok(treeOnlyHtml.includes("Screenshot unavailable"));
  assert.ok(treeOnlyHtml.includes("开拍"));
  assert.ok(treeOnlyHtml.includes('<script id="aui-data" type="application/json">'));
});

test("records per-tree truncation when maxNodes is reached", () => {
  const payload = viewerPayload(capture, { screenshot: null, maxNodes: 3 });
  const viewTree = payload.trees.view!;
  assert.equal(viewTree.nodeCount, 3);
  assert.equal(viewTree.truncated, true);
  assert.ok(viewTree.totalNodes > 3);
  assert.ok(payload.trees.semantics!.truncated);
  assert.ok(
    hasTruncatedPlaceholder(viewTree.roots),
    "truncated placeholders should be present",
  );
});

test("maps downscaled image pixels back to device pixels", () => {
  const half: Screenshot = {
    buffer: png,
    width: pngDimensions.width / 2,
    height: pngDimensions.height / 2,
    originalWidth: pngDimensions.width,
    originalHeight: pngDimensions.height,
    scale: 0.5,
  };
  const payload = viewerPayload(capture, { screenshot: half, createdAt });
  assert.deepEqual(payload.screenshot!.imageToDevice, { x: 2, y: 2 });
});

test("AUI_NO_OPEN=1 disables browser launch", async () => {
  const previous = process.env.AUI_NO_OPEN;
  let launcherCalled = false;
  try {
    process.env.AUI_NO_OPEN = "1";
    const result = await openInBrowser(defaultViewerPath(), {
      launcher: async () => {
        launcherCalled = true;
      },
    });
    assert.equal(result.opened, false);
    assert.equal(launcherCalled, false);
    assert.match(result.error ?? "", /AUI_NO_OPEN/);
  } finally {
    if (previous === undefined) delete process.env.AUI_NO_OPEN;
    else process.env.AUI_NO_OPEN = previous;
  }
});

test("an injected launcher reports the open result without spawning", async () => {
  const previous = process.env.AUI_NO_OPEN;
  delete process.env.AUI_NO_OPEN;
  try {
    const result = await openInBrowser(defaultViewerPath(), { launcher: async () => undefined });
    assert.equal(result.opened, true);
    assert.equal(result.browser, "custom");
  } finally {
    if (previous !== undefined) process.env.AUI_NO_OPEN = previous;
  }
});

test("defaultViewerPath points at .aui/viewer.html", () => {
  const path = defaultViewerPath("/tmp/base");
  const tail = path.split(/[\\/]/).slice(-2).join("/");
  assert.equal(tail, ".aui/viewer.html");
});