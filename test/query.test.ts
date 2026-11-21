import { test } from "node:test";
import { strict as assert } from "node:assert";
import { loadFixtureCapture } from "./fixtures.js";
import { findNodes, hitTest, nodePath } from "../src/core/query.js";

const capture = loadFixtureCapture();
const viewRoots = capture.view!.roots;
const semanticsRoots = capture.semantics!.roots;

test("finds text by default across multiple fields", () => {
  const matches = findNodes(semanticsRoots, { query: "开拍" });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].node.text, "开拍");
  assert.equal(matches[0].field, "text");
});

test("finds resource ids and classes", () => {
  assert.ok(
    findNodes(semanticsRoots, {
      query: "navigationBarBackground",
      by: "id",
      visibleOnly: false,
    }).length >= 1,
  );
  assert.equal(findNodes(viewRoots, { query: "AndroidComposeView", by: "class", match: "exact" }).length, 1);
});

test("supports regex and clickable filters", () => {
  const matches = findNodes(semanticsRoots, { query: "/00:\\d+/", match: "regex", clickableOnly: false });
  assert.ok(matches.length >= 4);
  const clickable = findNodes(semanticsRoots, { query: "开拍", clickableOnly: true });
  assert.equal(clickable.length, 0); // the TextView itself is not clickable
});

test("hit-testing prefers the smallest area and exposes overlapping candidates", () => {
  const hit = hitTest(semanticsRoots, 540, 2239);
  assert.ok(hit.primary);
  assert.equal(hit.primary.className, "android.widget.Button");
  assert.ok(hit.candidates.length >= 2);
  assert.ok(hit.candidates.some((node) => node.className === "android.view.View"));
});

test("hit-testing a view tree descends to the most specific view", () => {
  const hit = hitTest(viewRoots, 540, 100);
  assert.ok(hit.primary);
  const classes = hit.candidates.map((node) => node.shortClassName);
  assert.ok(classes.includes("AndroidComposeView"));
  assert.ok(classes.includes("DecorView"));
});

test("node paths include root to leaf labels", () => {
  const create = findNodes(semanticsRoots, { query: "开拍" })[0].node;
  const path = nodePath(create);
  assert.match(path, /FrameLayout/);
  assert.match(path, /ComposeView/);
  assert.match(path, /"开拍"/);
});
