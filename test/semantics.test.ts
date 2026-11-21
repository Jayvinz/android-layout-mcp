import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { parseSemanticsXml } from "../src/core/semantics.js";
import { flattenNodes } from "../src/core/viewdump.js";

const xml = readFileSync(new URL("./fixtures/semantics.xml", import.meta.url), "utf8");

function parse() {
  return parseSemanticsXml(xml, "com.example.droidreel.debug");
}

test("parses the uiautomator hierarchy", () => {
  const parsed = parse();
  assert.equal(parsed.roots.length, 1);
  assert.equal(parsed.rotation, 0);
  const nodes = flattenNodes(parsed.roots);
  assert.equal(nodes.length, 49);
  assert.equal(parsed.roots[0].className, "android.widget.FrameLayout");
  assert.equal(parsed.roots[0].bounds.bottom, 2276);
});

test("keeps UTF-8 text and content descriptions", () => {
  const nodes = flattenNodes(parse().roots);
  const tab = nodes.find((node) => node.text === "推荐");
  const create = nodes.find((node) => node.text === "开拍");
  const avatar = nodes.find((node) => node.contentDescription === "打开我的主页");
  assert.ok(tab);
  assert.ok(create);
  assert.ok(avatar);
  assert.equal(tab.bounds.left, 236);
  assert.equal(create.center.x, 570);
});

test("normalizes Clickable, scrollable and bounds attributes", () => {
  const nodes = flattenNodes(parse().roots);
  const clickable = nodes.filter((node) => node.clickable);
  assert.ok(clickable.length >= 10);
  const scroller = nodes.find((node) => node.scrollable);
  assert.ok(scroller);
  assert.equal(scroller.bounds.height, 1825);
  const navBackground = nodes.find((node) => node.resourceId === "android:id/navigationBarBackground");
  assert.ok(navBackground);
  assert.equal(navBackground.visible, false);
  assert.equal(navBackground.bounds.width, 0);
});

test("assigns parents and unique refs", () => {
  const nodes = flattenNodes(parse().roots);
  assert.equal(nodes[0].parent, null);
  assert.ok(nodes.slice(1).every((node) => node.parent !== null));
  assert.equal(new Set(nodes.map((node) => node.ref)).size, nodes.length);
  const createButtonText = nodes.find((node) => node.text === "开拍");
  assert.ok(createButtonText);
  assert.equal(createButtonText.parent?.clickable, true);
});
