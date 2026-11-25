import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { loadFixtureCapture, SCREEN } from "./fixtures.js";
import { analyzeCapture } from "../src/core/analyze.js";
import { mergeSemanticsText, parseDumpsys } from "../src/core/dumpsys.js";
import type { CaptureResult } from "../src/core/model.js";
import { parseSemanticsXml } from "../src/core/semantics.js";
import { flattenNodes } from "../src/core/viewdump.js";

const capture = loadFixtureCapture();

/** The same capture re-labelled as an XML screen, so the view tree is primary. */
function asXmlScreen(): CaptureResult {
  return { ...capture, uiKind: "xml" };
}

test("analyzes only the primary tree of a Compose screen", () => {
  // ViewDebug stops at AndroidComposeView, so the view tree holds only Compose
  // wrappers here; the semantics tree is the complete one and is analyzed alone.
  const result = analyzeCapture(capture, { rules: ["small_touch_target"] });
  assert.equal(result.nodeCount, flattenNodes(capture.semantics!.roots).length);
  assert.equal(result.dp, 2.75);
  // The default rule set walks the view tree again, but only for the two rules
  // that read raw View properties.
  const withProperties = analyzeCapture(capture);
  assert.equal(
    withProperties.nodeCount,
    flattenNodes(capture.semantics!.roots).length + flattenNodes(capture.view!.roots).length,
  );
});

test("flags zero-sized view containers but not semantic system placeholders", () => {
  const result = analyzeCapture(asXmlScreen(), { rules: ["zero_size"] });
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].className, "RippleContainer");
});

test("does not analyze the Compose wrapper view tree on a Compose screen", () => {
  // The RippleContainer above lives in the view tree; it must not be reported
  // when the semantics tree is the one a caller reads.
  const result = analyzeCapture(capture, { rules: ["zero_size"] });
  assert.ok(result.issues.every((issue) => issue.source === "semantics"));
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

test("analyzes a dumpsys-only capture instead of reporting nodeCount 0", () => {
  const text = readFileSync(new URL("./fixtures/dumpsys-activity.txt", import.meta.url), "utf8");
  const parsed = parseDumpsys(text, { packageName: "com.example.studymixed", screen: SCREEN });
  assert.ok(parsed.roots.length > 0);
  // Shrink one clickable dumpsys node so small_touch_target has to fire on it.
  const button = flattenNodes(parsed.roots).find((node) => node.clickable);
  assert.ok(button, "expected a clickable node in the fixture");
  const tiny = { left: 100, top: 100, right: 130, bottom: 130, width: 30, height: 30 };
  button.bounds = tiny;
  button.visibleBounds = { ...tiny };

  const dumpsysCapture: any = {
    ...captureWith([]),
    source: "dumpsys",
    sources: ["semantics", "dumpsys"],
    uiKind: "unknown",
    view: undefined,
    dumpsys: {
      activity: parsed.activity,
      roots: parsed.roots,
      fragments: [],
      labelledNodes: 0,
      captureMs: 5,
    },
  };
  const result = analyzeCapture(dumpsysCapture, { rules: ["small_touch_target"] });
  assert.equal(result.nodeCount, flattenNodes(parsed.roots).length);
  assert.ok(result.nodeCount > 0);
  const issue = result.issues.find((candidate) => candidate.rule === "small_touch_target");
  assert.ok(issue, "expected a tiny touch target on the dumpsys tree");
  assert.equal(issue.source, "dumpsys");
  assert.match(issue.nodeRef, /^d\d+$/);
});

/**
 * The real `--source dumpsys` capture: one dumpsys tree plus the semantics tree
 * that supplies its text. Both trees describe the same buttons, so analyzing
 * both reported every defect twice under two different refs (`d11` and `s9`).
 */
function mergedDumpsysCapture(): { capture: CaptureResult; dumpsysButton: any; semanticsButton: any } {
  const dumpsysText = readFileSync(new URL("./fixtures/dumpsys-activity.txt", import.meta.url), "utf8");
  const semanticsText = readFileSync(new URL("./fixtures/semantics-studymixed.xml", import.meta.url), "utf8");
  const parsed = parseDumpsys(dumpsysText, { packageName: "com.example.studymixed", screen: SCREEN });
  const semantics = parseSemanticsXml(semanticsText, "com.example.studymixed");
  const merged = mergeSemanticsText(parsed.roots, semantics.roots, { screen: SCREEN });
  return {
    capture: {
      device: {} as any,
      target: {} as any,
      screen: SCREEN,
      source: "dumpsys",
      sources: ["semantics", "dumpsys"],
      uiKind: "unknown",
      dumpsys: {
        activity: parsed.activity,
        roots: parsed.roots,
        fragments: [],
        labelledNodes: merged.labelled,
        captureMs: 5,
      },
      semantics: { rotation: 0, roots: semantics.roots, captureMs: 3 },
      warnings: [],
    },
    dumpsysButton: flattenNodes(parsed.roots).find((candidate) => candidate.ref === "d11"),
    semanticsButton: flattenNodes(semantics.roots).find((candidate) => candidate.ref === "s9"),
  };
}

test("reports a dumpsys capture defect once, not once per tree", () => {
  const { capture: dumpsysCapture, dumpsysButton, semanticsButton } = mergedDumpsysCapture();
  assert.ok(dumpsysButton && semanticsButton, "expected the same button in both fixtures");
  // The 10.9dp button from the reported scenario: dumpsys `d11` and semantics
  // `s9` are the same on-screen element, at the same bounds.
  const tiny = { left: 100, top: 100, right: 130, bottom: 130, width: 30, height: 30 };
  dumpsysButton.bounds = { ...tiny };
  dumpsysButton.visibleBounds = { ...tiny };
  semanticsButton.bounds = { ...tiny };
  semanticsButton.visibleBounds = { ...tiny };

  // Each tree on its own reports the small touch target once.
  const dumpsysOnly = analyzeCapture({ ...dumpsysCapture, semantics: undefined }, { rules: ["small_touch_target"] });
  const semanticsOnly = analyzeCapture(
    { ...dumpsysCapture, source: "semantics", dumpsys: undefined },
    { rules: ["small_touch_target"] },
  );
  assert.equal(dumpsysOnly.counts.small_touch_target, 1);
  assert.equal(semanticsOnly.counts.small_touch_target, 1);

  // Together they must still report it once: the analyzed tree is the dumpsys
  // one, because that is the tree a `--source dumpsys` caller reads.
  const combined = analyzeCapture(dumpsysCapture, { rules: ["small_touch_target"] });
  assert.equal(combined.counts.small_touch_target, 1, "the same element must not be counted twice");
  assert.equal(combined.issues.length, 1);
  assert.equal(combined.issues[0].source, "dumpsys");
  assert.equal(combined.issues[0].nodeRef, "d11");
});

/** A clickable node below the 48dp threshold, in device pixels. */
function tinyClickable(left: number, top: number, overrides: Record<string, unknown> = {}): any {
  const bounds = { left, top, right: left + 30, bottom: top + 30, width: 30, height: 30 };
  return node({ bounds, visibleBounds: { ...bounds }, clickable: true, ...overrides });
}

/** A root node that spans the whole screen, with its children linked to it. */
function screenRoot(overrides: Record<string, unknown>, children: any[]): any {
  const bounds = { left: 0, top: 0, right: 1080, bottom: 2400, width: 1080, height: 2400 };
  const root = node({ bounds, visibleBounds: { ...bounds }, children, ...overrides });
  for (const child of children) child.parent = root;
  return root;
}

test("an auto capture with both trees reports a defect once", () => {
  // `auto` on an XML screen captures view + semantics but reads the view tree.
  const viewRoot = screenRoot({ id: "0", ref: "v0", source: "view" }, [
    tinyClickable(10, 10, { id: "0.0", ref: "v1", depth: 1, source: "view" }),
  ]);
  const semanticsRoot = screenRoot({ id: "0", ref: "s0", source: "semantics" }, [
    tinyClickable(10, 10, { id: "0.0", ref: "s1", depth: 1, source: "semantics" }),
  ]);
  const autoCapture = {
    ...captureWith([viewRoot]),
    uiKind: "xml",
    source: "view",
    sources: ["view", "semantics"],
    semantics: { rotation: 0, roots: [semanticsRoot], captureMs: 1 },
  } as CaptureResult;

  const result = analyzeCapture(autoCapture, { rules: ["small_touch_target"] });
  assert.equal(result.counts.small_touch_target, 1);
  assert.equal(result.issues[0].source, "view");
  assert.equal(result.issues[0].nodeRef, "v1");
  // Only the tree that is read contributes to nodeCount.
  assert.equal(result.nodeCount, flattenNodes([viewRoot]).length);
});

test("a mixed screen analyzes both trees because they cover different regions", () => {
  // ViewDebug stops at AndroidComposeView: the view tree holds the XML region
  // and the semantics tree the Compose region, so an issue in each must appear.
  const viewRoot = screenRoot({ id: "0", ref: "v0", source: "view" }, [
    tinyClickable(10, 10, { id: "0.0", ref: "v1", depth: 1, source: "view" }),
  ]);
  const semanticsRoot = screenRoot({ id: "0", ref: "s0", source: "semantics" }, [
    tinyClickable(600, 1800, { id: "0.0", ref: "s1", depth: 1, source: "semantics" }),
  ]);
  const mixedCapture = {
    ...captureWith([viewRoot]),
    uiKind: "mixed",
    source: "view",
    sources: ["view", "semantics"],
    semantics: { rotation: 0, roots: [semanticsRoot], captureMs: 1 },
  } as CaptureResult;

  const result = analyzeCapture(mixedCapture, { rules: ["small_touch_target"] });
  assert.equal(result.counts.small_touch_target, 2);
  assert.deepEqual(new Set(result.issues.map((issue) => issue.source)), new Set(["view", "semantics"]));
  assert.deepEqual(result.issues.map((issue) => issue.nodeRef).sort(), ["s1", "v1"]);
});

test("property rules still fire from the view tree when the analyzed tree is semantics", () => {
  const parent = node({
    id: "0", ref: "v0",
    view: { visibility: "visible", properties: { "miui:backgroundDrawableName": "android.graphics.drawable.ColorDrawable" } },
  });
  const overdrawn = node({
    id: "0.0", ref: "v1", depth: 1, parent,
    view: { visibility: "visible", properties: { "miui:backgroundDrawableName": "android.graphics.drawable.RippleDrawable" } },
  });
  const hardcodedMargin = node({
    id: "0.1", ref: "v2", depth: 1, parent,
    view: { visibility: "visible", properties: { "layoutParams.leftMargin": 16, "layoutParams.rightMargin": 0 } },
  });
  // A zero-sized view: the supplementary pass must not run non-property rules.
  const zeroSized = node({
    id: "0.2", ref: "v3", depth: 1, parent,
    bounds: { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 },
    visibleBounds: null,
    view: { visibility: "visible" },
  });
  parent.children = [overdrawn, hardcodedMargin, zeroSized];
  const semanticsRoot = screenRoot({ id: "0", ref: "s0", source: "semantics" }, []);

  const result = analyzeCapture(
    {
      ...captureWith([parent]),
      // Compose screen: ViewDebug stops at AndroidComposeView, so the semantics
      // tree is what a caller reads, and raw properties live in the view tree.
      uiKind: "compose",
      source: "semantics",
      semantics: { rotation: 0, roots: [semanticsRoot], captureMs: 1 },
    } as CaptureResult,
    { rules: ["overdraw", "rtl_issues", "zero_size"] },
  );

  assert.equal(result.counts.overdraw, 1);
  assert.equal(result.counts.rtl_issues, 1);
  assert.equal(result.counts.zero_size ?? 0, 0, "only the two property rules may run on the view tree");
  assert.ok(result.issues.every((issue) => issue.source === "view"));
  assert.equal(result.nodeCount, 1 + flattenNodes([parent]).length);
});

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
  // The hint must work for both front ends, not just the CLI flag.
  assert.match((result.skipped ?? []).join(" "), /includeProperties=true/);
});

test("a mixed screen never analyzes the compose tree alongside view and semantics", () => {
  // Compose captures set source="compose" and never coexist with a view tree, so
  // counting compose here could only duplicate the semantics nodes.
  const capture: any = {
    ...captureWith([]),
    source: "view",
    sources: ["view", "semantics", "compose"],
    uiKind: "mixed",
    view: { window: "w", captureMs: 1, roots: [node({ id: "0", ref: "v0", depth: 0 })] },
    semantics: { rotation: 0, captureMs: 1, roots: [node({ id: "1", ref: "s0", source: "semantics" })] },
    compose: { rootViewId: 1, captureMs: 1, roots: [node({ id: "2", ref: "c0", source: "compose" })] },
  };
  const result = analyzeCapture(capture, { rules: ["zero_size"] });
  const sources = new Set(result.issues.map((issue) => issue.source));
  assert.equal(sources.has("compose"), false, "the compose tree must not be analyzed on a mixed screen");
  // The two disjoint trees are still both scanned.
  assert.equal(result.nodeCount, 2);
});

test("analyzeCapture refuses to report a clean screen for a tree-less capture", () => {
  const empty: any = {
    ...captureWith([]),
    source: "semantics",
    sources: [],
    uiKind: "unknown",
    view: undefined,
  };
  assert.throws(
    () => analyzeCapture(empty, { rules: ["small_touch_target"] }),
    /No UI tree to analyze/,
  );
});
