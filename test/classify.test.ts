import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { classifyUi } from "../src/core/capture.js";
import { parseViewHierarchy } from "../src/core/viewdump.js";
import type { Bounds, ScreenInfo, UiNode } from "../src/core/model.js";
import { loadFixtureCapture } from "./fixtures.js";

const bounds: Bounds = { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 };

function node(className: string, children: UiNode[] = [], extra: Partial<UiNode> = {}): UiNode {
  return {
    id: "0",
    ref: "v0",
    source: "view",
    index: 0,
    depth: 0,
    className,
    shortClassName: className.split(".").pop() ?? className,
    packageName: "com.example",
    resourceId: null,
    text: null,
    contentDescription: null,
    bounds,
    visibleBounds: bounds,
    center: { x: 50, y: 50 },
    visible: true,
    enabled: true,
    clickable: false,
    longClickable: false,
    focusable: false,
    focused: false,
    scrollable: false,
    checkable: false,
    checked: false,
    selected: false,
    password: false,
    children,
    ...extra,
  };
}

test("classifies pure XML screens", () => {
  const root = node("com.android.internal.policy.DecorView", [
    node("android.widget.FrameLayout", [
      node("android.widget.LinearLayout", [
        node("android.widget.TextView", [], { text: "hello" }),
        node("android.widget.Button", [], { clickable: true }),
      ]),
    ]),
  ]);
  assert.equal(classifyUi([root]), "xml");
});

test("classifies pure Compose screens", () => {
  const root = node("com.android.internal.policy.DecorView", [
    node("android.widget.FrameLayout", [
      node("androidx.compose.ui.platform.ComposeView", [
        node("androidx.compose.ui.platform.AndroidComposeView", [
          node("androidx.compose.material.ripple.RippleContainer"),
          node("androidx.compose.ui.platform.AndroidViewsHandler"),
        ]),
      ]),
      node("android.view.View", [], { resourceId: "android:id/navigationBarBackground" }),
    ]),
    node("android.view.ViewStub"),
  ]);
  assert.equal(classifyUi([root]), "compose");
});

test("classifies XML + Compose mixed screens", () => {
  const root = node("com.android.internal.policy.DecorView", [
    node("android.widget.LinearLayout", [
      node("android.widget.TextView", [], { text: "xml title" }),
      node("androidx.compose.ui.platform.ComposeView", [
        node("androidx.compose.ui.platform.AndroidComposeView"),
      ]),
    ]),
  ]);
  assert.equal(classifyUi([root]), "mixed");
});

test("classifies AndroidView interop children as mixed", () => {
  const root = node("com.android.internal.policy.DecorView", [
    node("androidx.compose.ui.platform.ComposeView", [
      node("androidx.compose.ui.platform.AndroidComposeView", [
        node("androidx.compose.ui.platform.AndroidViewsHandler", [
          node("android.widget.TextView", [], { text: "interop" }),
        ]),
      ]),
    ]),
  ]);
  assert.equal(classifyUi([root]), "mixed");
});


test("classifies the recorded Compose and XML fixtures", () => {
  assert.equal(classifyUi(loadFixtureCapture().view!.roots), "compose");
  const screen: ScreenInfo = {
    width: 1080,
    height: 2400,
    density: 2.75,
    densityDpi: 440,
    orientation: "portrait",
    rotation: 0,
  };
  const xml = parseViewHierarchy(
    readFileSync(new URL("./fixtures/hierarchy-xml-v2.bin", import.meta.url)),
    { screen },
  );
  assert.equal(classifyUi(xml), "xml");
});
