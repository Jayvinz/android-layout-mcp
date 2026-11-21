import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { flattenNodes, parseViewHierarchy } from "../src/core/viewdump.js";
import { findNodes, hitTest } from "../src/core/query.js";
import { SCREEN } from "./fixtures.js";

const screen = SCREEN;

const buffer = readFileSync(new URL("./fixtures/hierarchy-xml-v2.bin", import.meta.url));

function parse() {
  return parseViewHierarchy(buffer, {
    screen,
    packageName: "com.example.demo.free.debug",
    includeProperties: true,
  });
}

test("captures a traditional XML View hierarchy", () => {
  const nodes = flattenNodes(parse());
  assert.equal(nodes.length, 20);
  assert.equal(nodes[0].className, "com.android.internal.policy.DecorView");
  const classes = nodes.map((node) => node.shortClassName);
  for (const expected of ["ActionBarOverlayLayout", "FrameLayout", "LinearLayout", "TextView", "Button", "ScrollView", "Toolbar"]) {
    assert.ok(classes.includes(expected), `missing ${expected}`);
  }
});

test("extracts API 33 TextView text via text:text", () => {
  const nodes = flattenNodes(parse());
  const title = nodes.find((node) => node.text === "Android SPI · variant self-check");
  const button = nodes.find((node) => node.text === "Re-run checks");
  const longText = nodes.find((node) => (node.text ?? "").startsWith("[PASS] C01"));
  assert.ok(title, "title text missing");
  assert.ok(button, "button text missing");
  assert.ok(longText, "long text missing");
  assert.equal(button.shortClassName, "Button");
  assert.equal(button.clickable, true);
});

test("keeps exact class names, ids and text properties for XML views", () => {
  const nodes = flattenNodes(parse());
  const content = nodes.find((node) => node.resourceId === "id/content");
  const toolbar = nodes.find((node) => node.resourceId === "id/action_bar");
  const button = nodes.find((node) => node.text === "Re-run checks");
  assert.ok(content);
  assert.ok(toolbar);
  assert.ok(button);
  assert.equal(content.className, "android.widget.FrameLayout");
  assert.equal(toolbar.className, "android.widget.Toolbar");
  assert.equal(button.view?.properties?.["text:text"], "Re-run checks");
  assert.equal(button.view?.properties?.["text:textSize"], 30.7450008392334);
  assert.equal(button.view?.layoutParams.width, 0); // 0dp weight
});

test("find and hit-test work without semantics for XML screens", () => {
  const roots = parse();
  const matches = findNodes(roots, { query: "Re-run checks" });
  assert.equal(matches.length, 1);
  const hit = hitTest(roots, 289, 1019);
  assert.ok(hit.primary);
  assert.equal(hit.primary.text, "Re-run checks");
  assert.equal(hit.primary.className, "android.widget.Button");
});

test("bounds and scrolling containers are computed", () => {
  const nodes = flattenNodes(parse());
  const scroller = nodes.find((node) => node.shortClassName === "ScrollView");
  assert.ok(scroller);
  assert.equal(scroller.scrollable, true);
  assert.equal(scroller.bounds.top, 1085);
  assert.equal(scroller.bounds.height, 1238);
});
