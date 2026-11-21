import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { flattenNodes, parseViewHierarchy } from "../src/core/viewdump.js";
import { SCREEN } from "./fixtures.js";

const screen = SCREEN;

const buffer = readFileSync(new URL("./fixtures/hierarchy-v2.bin", import.meta.url));

test("decodes a ViewDebug v2 dump into a view tree", () => {
  const roots = parseViewHierarchy(buffer, { screen, packageName: "com.example.app" });
  assert.equal(roots.length, 1);
  assert.equal(roots[0].className, "com.android.internal.policy.DecorView");
  assert.equal(roots[0].bounds.width, 1080);
  assert.equal(roots[0].bounds.height, 2400);
  assert.equal(roots[0].visible, true);
  assert.equal(roots[0].source, "view");
});

test("keeps Compose containers and their bounds", () => {
  const nodes = flattenNodes(parseViewHierarchy(buffer, { screen }));
  const composeView = nodes.find((node) => node.shortClassName === "ComposeView");
  const composeRoot = nodes.find((node) => node.shortClassName === "AndroidComposeView");
  assert.ok(composeView);
  assert.ok(composeRoot);
  assert.equal(composeView.bounds.width, 1080);
  assert.equal(composeRoot.bounds.height, 2400);
});

test("maps API 33 property names (layout:left, misc:visibility, ...)", () => {
  const nodes = flattenNodes(parseViewHierarchy(buffer, { screen, includeProperties: true }));
  const composeRoot = nodes.find((node) => node.shortClassName === "AndroidComposeView");
  assert.ok(composeRoot?.view);
  assert.equal(composeRoot.view.layoutParams.width, -2); // wrap_content
  assert.equal(composeRoot.view.clipChildren, false);
  assert.equal(composeRoot.view.visibility, "visible");
  assert.equal(composeRoot.view.properties?.["layout:left"], 0);
  assert.equal(composeRoot.view.properties?.["scrolling:scrollY"], 0);
});

test("computes visibility and clipping", () => {
  const nodes = flattenNodes(parseViewHierarchy(buffer, { screen }));
  const rippleContainer = nodes.find((node) => node.shortClassName === "RippleContainer");
  const viewStub = nodes.find((node) => node.shortClassName === "ViewStub");
  const rippleHost = nodes.find((node) => node.shortClassName === "RippleHostView");
  assert.ok(rippleContainer);
  assert.ok(viewStub);
  assert.ok(rippleHost);
  assert.equal(rippleContainer.visible, false);
  assert.equal(rippleContainer.visibleBounds, null);
  assert.equal(viewStub.view?.visibility, "gone");
  // RippleContainer is zero-sized but has clipChildren=false, so its child can
  // still draw (and be hit-tested) outside the parent's bounds.
  assert.equal(rippleHost.visible, true);
  assert.equal(rippleHost.visibleBounds?.width, 261);
  assert.equal(rippleHost.visibleBounds?.height, 110);
});

test("assigns unique refs and id paths", () => {
  const nodes = flattenNodes(parseViewHierarchy(buffer, { screen }));
  const refs = new Set(nodes.map((node) => node.ref));
  const ids = new Set(nodes.map((node) => node.id));
  assert.equal(refs.size, nodes.length);
  assert.equal(ids.size, nodes.length);
  assert.equal(nodes[0].id, "0");
  assert.ok(nodes.some((node) => node.id === "0.0.0"));
});
