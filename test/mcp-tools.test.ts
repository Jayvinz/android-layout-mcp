import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { analyzeCapture, type RuleName } from "../src/core/analyze.js";
import { parseDumpsys } from "../src/core/dumpsys.js";
import type { CaptureResult, DeviceInfo, ScreenInfo, UiNode } from "../src/core/model.js";
import {
  analyzeCaptureArgs,
  buildDumpUiPayload,
  buildHitTestReports,
  hitTestSource,
  refHint,
  ruleSchema,
  sourceSchema,
} from "../src/mcp.js";

const dumpsys = readFileSync(new URL("./fixtures/dumpsys-activity.txt", import.meta.url), "utf8");

/**
 * The MCP handler bodies are closures inside `startMcpServer` and every tool
 * call starts with a real device capture, so they cannot be driven offline
 * without a device. These tests therefore drive the exported pure helpers the
 * handlers delegate to, and read the handler wiring out of the source so the
 * two cannot drift apart.
 */
const mcpSource = readFileSync(new URL("../src/mcp.ts", import.meta.url), "utf8");

function toolBlock(name: string, nextName: string): string {
  const start = mcpSource.indexOf(`"${name}"`);
  const end = mcpSource.indexOf(`"${nextName}"`);
  assert.ok(start >= 0 && end > start, `could not locate the ${name} registration`);
  return mcpSource.slice(start, end);
}

const SCREEN: ScreenInfo = {
  width: 1080,
  height: 2400,
  density: 2.75,
  densityDpi: 440,
  orientation: "portrait",
  rotation: 0,
};

const DEVICE: DeviceInfo = {
  serial: "fixture",
  state: "device",
  model: "Fixture",
  product: null,
  device: null,
  transportId: null,
  manufacturer: "Test",
  androidRelease: "13",
  sdk: 33,
};

/** A dumpsys-only CaptureResult, as `capture(source=dumpsys)` returns it. */
function dumpsysCapture(): CaptureResult {
  const parsed = parseDumpsys(dumpsys, { packageName: "com.example.studymixed", screen: SCREEN });
  return {
    device: DEVICE,
    target: {
      serial: DEVICE.serial,
      packageName: "com.example.studymixed",
      pid: 5866,
      activity: parsed.activity,
      debuggable: false,
      windows: [],
    },
    screen: SCREEN,
    source: "dumpsys",
    sources: ["semantics", "dumpsys"],
    uiKind: "unknown",
    dumpsys: {
      activity: parsed.activity,
      roots: parsed.roots,
      fragments: [],
      labelledNodes: 3,
      captureMs: 12,
    },
    warnings: [],
  };
}

/** Minimal node builder shared by the hit-test fixtures. */
function node(overrides: Record<string, unknown>): UiNode {
  return {
    id: "0",
    ref: "v0",
    source: "view",
    index: 0,
    depth: 0,
    className: "android.widget.FrameLayout",
    shortClassName: "FrameLayout",
    packageName: "com.example.studymixed",
    resourceId: null,
    text: null,
    contentDescription: null,
    bounds: { left: 0, top: 0, right: 1080, bottom: 2400, width: 1080, height: 2400 },
    visibleBounds: { left: 0, top: 0, right: 1080, bottom: 2400, width: 1080, height: 2400 },
    center: { x: 540, y: 1200 },
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
    parent: null,
    ...overrides,
  } as UiNode;
}

/** A capture holding both a view tree and a semantics tree, as `auto` produces. */
function twoTreeCapture(): CaptureResult {
  const viewRoot = node({ id: "0", ref: "v0", source: "view" });
  const viewChild = node({
    id: "0.0",
    ref: "v1",
    source: "view",
    depth: 1,
    parent: viewRoot,
    className: "android.widget.TextView",
    shortClassName: "TextView",
    text: "xml",
    bounds: { left: 0, top: 1000, right: 1080, bottom: 1400, width: 1080, height: 400 },
    visibleBounds: { left: 0, top: 1000, right: 1080, bottom: 1400, width: 1080, height: 400 },
    center: { x: 540, y: 1200 },
  });
  viewRoot.children = [viewChild];
  const semanticsRoot = node({
    id: "0",
    ref: "s0",
    source: "semantics",
    className: "android.view.View",
    shortClassName: "View",
  });
  const semanticsChild = node({
    id: "0.0",
    ref: "s1",
    source: "semantics",
    depth: 1,
    parent: semanticsRoot,
    className: "android.widget.Button",
    shortClassName: "Button",
    text: "compose",
    clickable: true,
    bounds: { left: 100, top: 1100, right: 900, bottom: 1300, width: 800, height: 200 },
    visibleBounds: { left: 100, top: 1100, right: 900, bottom: 1300, width: 800, height: 200 },
    center: { x: 500, y: 1200 },
  });
  semanticsRoot.children = [semanticsChild];
  return {
    device: DEVICE,
    target: {
      serial: DEVICE.serial,
      packageName: "com.example.studymixed",
      pid: 5866,
      activity: ".EntryActivity",
      debuggable: true,
      windows: [],
    },
    screen: SCREEN,
    source: "view",
    sources: ["view", "semantics"],
    uiKind: "mixed",
    view: { window: "main", roots: [viewRoot], captureMs: 5 },
    semantics: { rotation: 0, roots: [semanticsRoot], captureMs: 3 },
    warnings: [],
  };
}

function refsOf(roots: unknown[]): string[] {
  const refs: string[] = [];
  const walk = (node: unknown) => {
    const typed = node as { ref?: string; children?: unknown[] };
    if (typed.ref) refs.push(typed.ref);
    for (const child of typed.children ?? []) walk(child);
  };
  for (const root of roots) walk(root);
  return refs;
}

test("dump_ui json payload carries the dumpsys tree with d* refs", () => {
  const capture = dumpsysCapture();
  const payload = buildDumpUiPayload(capture, { includeProperties: false }) as Record<string, any>;
  assert.ok(payload.dumpsys, "expected a dumpsys section");
  assert.equal(payload.dumpsys.activity, "com.example.studymixed/.EntryActivity");
  assert.equal(payload.dumpsys.captureMs, 12);
  assert.equal(payload.dumpsys.labelledNodes, 3);
  assert.ok(Array.isArray(payload.dumpsys.fragments));
  assert.ok(Array.isArray(payload.dumpsys.roots) && payload.dumpsys.roots.length > 0);
  const refs = refsOf(payload.dumpsys.roots);
  assert.ok(refs.length > 0);
  assert.ok(refs.every((ref) => /^d\d+$/.test(ref)), `unexpected refs: ${refs.slice(0, 5)}`);
  // The dumpsys-only capture has no view/semantics/compose sections.
  assert.equal(payload.view, undefined);
  assert.equal(payload.semantics, undefined);
  assert.equal(payload.compose, undefined);
  assert.match(payload.hint, /\(d\*\)/);
});

test("dump_ui payload omits dumpsys when the capture has none", () => {
  const capture = dumpsysCapture();
  const payload = buildDumpUiPayload({ ...capture, dumpsys: undefined, source: "semantics" }) as Record<string, any>;
  assert.equal(payload.dumpsys, undefined);
  assert.match(payload.hint, /\(s\*\)/);
});

test("dump_ui hint names the ref prefix of the captured source", () => {
  assert.match(refHint("view"), /\(v\*\)/);
  assert.match(refHint("semantics"), /\(s\*\)/);
  assert.match(refHint("dumpsys"), /\(d\*\)/);
  assert.match(refHint("compose"), /\(c\*\)/);
});

test("analyze_ui rule enum covers every analyze rule, including overdraw and rtl_issues", () => {
  const options = [...ruleSchema.options].sort();
  const expected: RuleName[] = [
    "clipped",
    "deep_nesting",
    "duplicate_id",
    "invisible_clickable",
    "offscreen",
    "outside_parent",
    "overdraw",
    "overlap",
    "rtl_issues",
    "small_touch_target",
    "unlabeled_clickable",
    "zero_size",
  ];
  assert.deepEqual(options, expected);
  // The MCP enum must accept every rule analyzeCapture knows about.
  for (const rule of expected) assert.ok(ruleSchema.safeParse(rule).success, `${rule} rejected`);
});

test("analyze_ui captures raw View properties by default and only opts out on false", () => {
  assert.deepEqual(analyzeCaptureArgs({}), { includeProperties: true });
  assert.deepEqual(analyzeCaptureArgs({ includeProperties: undefined }), { includeProperties: true });
  assert.deepEqual(analyzeCaptureArgs({ includeProperties: true }), { includeProperties: true });
  assert.deepEqual(analyzeCaptureArgs({ includeProperties: false }), { includeProperties: false });

  // The helper is only half of the contract: the shipped tool must declare the
  // flag and pass the helper's result into the capture.
  const block = toolBlock("analyze_ui", "list_fragments");
  assert.match(block, /includeProperties: z\s*\.boolean\(\)/, "the schema must declare includeProperties");
  assert.match(block, /\.\.\.analyzeCaptureArgs\(args\)/, "the handler must spread analyzeCaptureArgs(args)");
});

test("analyze_ui with default properties can run overdraw and rtl_issues", () => {
  const capture = dumpsysCapture();
  const args = analyzeCaptureArgs({});
  assert.equal(args.includeProperties, true);
  // A dumpsys-only capture cannot run the property rules, and says so.
  const result = analyzeCapture(capture, { rules: ["overdraw", "rtl_issues"] });
  assert.ok((result.skipped ?? []).length > 0);
});

test("hit_test source: auto and undefined mean both, explicit sources pass through", () => {
  assert.equal(hitTestSource(undefined), "both");
  assert.equal(hitTestSource("auto"), "both");
  for (const source of ["view", "semantics", "dumpsys", "compose", "both"] as const) {
    assert.equal(hitTestSource(source), source);
  }
});

test("hit_test(source=dumpsys) resolves the dumpsys tree, not both", () => {
  const capture = dumpsysCapture();
  // `buildHitTestReports` derives the `both` argument from the requested source
  // exactly as the handler does, so a hard-coded `true` in the handler cannot
  // keep this test green.
  const reports = buildHitTestReports(capture, { x: 540, y: 400, source: "dumpsys" });
  assert.equal(reports.length, 1);
  assert.equal(reports[0].tree, "dumpsys");
  assert.ok(reports[0].candidates.length > 0, "expected a candidate at the point");
  assert.ok(reports[0].candidates.every((candidate) => /^d\d+$/.test(candidate.ref)));
  assert.equal(hitTestSource("dumpsys"), "dumpsys");

  // And the handler itself must delegate instead of re-implementing the choice.
  const block = toolBlock("hit_test", "analyze_ui");
  assert.match(block, /buildHitTestReports\(result, args\)/);
  assert.doesNotMatch(block, /treesFor\(/, "only buildHitTestReports may decide which trees to query");
});

test("hit_test on auto queries both trees, an explicit source only its own", () => {
  const capture = twoTreeCapture();
  const auto = buildHitTestReports(capture, { x: 540, y: 1200 });
  assert.deepEqual(auto.map((report) => report.tree), ["view", "semantics"]);
  const semanticsOnly = buildHitTestReports(capture, { x: 540, y: 1200, source: "semantics" });
  assert.deepEqual(semanticsOnly.map((report) => report.tree), ["semantics"]);
  // `index` selects among overlapping candidates, as the tool hint says.
  const second = buildHitTestReports(capture, { x: 540, y: 1200, source: "semantics", index: 1 });
  assert.equal(second[0].selected?.index, 1);
});

test("the MCP source enum accepts dumpsys", () => {
  assert.ok(sourceSchema.safeParse("dumpsys").success);
});
test("every shipped tool description carries the Android gate", () => {
  // Non-Claude-Code clients have no PreToolUse hook, so the description text is
  // the only gate they see. A tool without it is ungated for those clients.
  const source = readFileSync(new URL("../src/mcp.ts", import.meta.url), "utf8");
  const blocks = [...source.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((match, index, all) => {
    const start = match.index ?? 0;
    const end = index + 1 < all.length ? (all[index + 1].index ?? source.length) : source.length;
    return { name: match[1], body: source.slice(start, end) };
  });
  assert.equal(blocks.length, 9, "expected the nine shipped tools");
  for (const { name, body } of blocks) {
    const carriesGate =
      body.includes("non-Android: call only on an explicit device/screen request or Android mention") ||
      body.includes("non-Android: call only on an explicit Android/device request");
    assert.ok(carriesGate, `${name} description is missing the Android gate sentence`);
  }
});
