import { test } from "node:test";
import { strict as assert } from "node:assert";
import { loadFixtureCapture } from "./fixtures.js";
import { analyzeCapture } from "../src/core/analyze.js";

const capture = loadFixtureCapture();

test("analyzes both view and semantics trees", () => {
  const result = analyzeCapture(capture);
  assert.equal(result.nodeCount, 59); // 10 view nodes + 49 semantic nodes
  assert.equal(result.dp, 2.75);
  assert.ok(result.counts.zero_size >= 1);
});

test("flags zero-sized view containers but not semantic system placeholders", () => {
  const result = analyzeCapture(capture, { rules: ["zero_size"] });
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].className, "RippleContainer");
});

test("does not false-positive small touch targets when the dump is clipped at the bottom", () => {
  const result = analyzeCapture(capture, { rules: ["small_touch_target"] });
  // MIUI reports a 2276px-tall accessibility window on a 2400px screen; the
  // bottom navigation buttons are clipped, so their measured height is invalid.
  assert.equal(result.issues.length, 0);
});

test("ignores clickable containers that are labelled by descendants", () => {
  const result = analyzeCapture(capture, { rules: ["unlabeled_clickable"] });
  // The two empty card placeholders have no text yet; everything else is labelled.
  assert.equal(result.issues.length, 2);
  assert.ok(result.issues.every((issue) => issue.source === "semantics"));
});

test("rule subset and dp threshold are honoured", () => {
  const result = analyzeCapture(capture, { rules: ["deep_nesting"], maxDepth: 3 });
  assert.ok(result.issues.length > 0);
  assert.equal(result.counts.deep_nesting, result.issues.length);
});

/** Minimal node builder for rule unit tests. */
function node(overrides: Record<string, unknown>): any {
  return {
    id: "x",
    ref: "x",
    source: "view",
    className: "android.widget.FrameLayout",
    shortClassName: "FrameLayout",
    packageName: null,
    resourceId: null,
    text: null,
    contentDescription: null,
    bounds: { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 },
    visibleBounds: { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 },
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
    children: [],
    depth: 0,
    index: 0,
    parent: null,
    ...overrides,
  };
}

function captureWith(roots: any[]): any {
  return {
    device: {},
    target: {},
    screen: { width: 1080, height: 2400, density: 2.75, densityDpi: 440, orientation: "portrait", rotation: 0 },
    source: "view",
    sources: ["view"],
    uiKind: "xml",
    view: { window: "w", roots, captureMs: 1 },
    warnings: [],
  };
}

test("overdraw flags a child painting a different background over its parent", () => {
  const parent = node({
    id: "0", ref: "p",
    view: { properties: { "miui:backgroundDrawableName": "android.graphics.drawable.ColorDrawable" } },
  });
  const child = node({
    id: "0.0", ref: "c", depth: 1, parent,
    view: {
      visibility: "visible",
      properties: { "miui:backgroundDrawableName": "android.graphics.drawable.RippleDrawable" },
    },
  });
  parent.children = [child];
  const result = analyzeCapture(captureWith([parent]), { rules: ["overdraw"] });
  assert.equal(result.counts.overdraw, 1);
  assert.match(result.issues[0].message, /RippleDrawable/);
  assert.match(result.issues[0].message, /ColorDrawable/);
});

test("overdraw ignores identical backgrounds and partial coverage", () => {
  const parent = node({
    id: "0", ref: "p",
    view: { properties: { "miui:backgroundDrawableName": "android.graphics.drawable.ColorDrawable" } },
  });
  const same = node({
    id: "0.0", ref: "c", depth: 1, parent,
    view: {
      visibility: "visible",
      properties: { "miui:backgroundDrawableName": "android.graphics.drawable.ColorDrawable" },
    },
  });
  const partial = node({
    id: "0.1", ref: "d", depth: 1, parent,
    bounds: { left: 0, top: 0, right: 40, bottom: 40, width: 40, height: 40 },
    visibleBounds: { left: 0, top: 0, right: 40, bottom: 40, width: 40, height: 40 },
    view: {
      visibility: "visible",
      properties: { "miui:backgroundDrawableName": "android.graphics.drawable.RippleDrawable" },
    },
  });
  parent.children = [same, partial];
  const result = analyzeCapture(captureWith([parent]), { rules: ["overdraw"] });
  assert.equal(result.counts.overdraw ?? 0, 0);
});

test("rtl_issues flags a hardcoded margin with no start/end counterpart", () => {
  const view = node({
    view: {
      visibility: "visible",
      properties: {
        "layoutParams.leftMargin": 16,
        "layoutParams.rightMargin": 0,
        "layoutParams.startMargin": -2147483648,
        "layoutParams.endMargin": -2147483648,
      },
    },
  });
  const result = analyzeCapture(captureWith([view]), { rules: ["rtl_issues"] });
  assert.equal(result.counts.rtl_issues, 1);
  assert.match(result.issues[0].message, /leftMargin/);
  assert.match(result.issues[0].message, /marginStart/i);
});

test("rtl_issues stays quiet when start/end margins are set", () => {
  const view = node({
    view: {
      visibility: "visible",
      properties: {
        "layoutParams.leftMargin": 16,
        "layoutParams.rightMargin": 0,
        "layoutParams.startMargin": 16,
        "layoutParams.endMargin": 0,
      },
    },
  });
  const result = analyzeCapture(captureWith([view]), { rules: ["rtl_issues"] });
  assert.equal(result.counts.rtl_issues ?? 0, 0);
});

test("rtl_issues and overdraw report being skipped when properties were not captured", () => {
  const plain = node({}); // no view.properties
  const result = analyzeCapture(captureWith([plain]), { rules: ["rtl_issues", "overdraw"] });
  assert.ok(result.skipped, "expected a skipped note");
  assert.match((result.skipped ?? []).join(" "), /overdraw/);
  assert.match((result.skipped ?? []).join(" "), /rtl_issues/);
  assert.match((result.skipped ?? []).join(" "), /--props/);
});
