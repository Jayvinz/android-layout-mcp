import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { CAPTURE_ALL_WINDOWS, chooseWindows } from "../src/core/capture.js";
import type { CaptureResult, WindowInfo } from "../src/core/model.js";
import { buildCompactPayload } from "../src/core/prune.js";
import { renderCapture } from "../src/core/render.js";
import { serializeDump } from "../src/core/serialize.js";
import { buildDumpUiPayload } from "../src/mcp.js";
import { loadFixtureCapture, makeTestNode } from "./fixtures.js";

const mcpSource = readFileSync(new URL("../src/mcp.ts", import.meta.url), "utf8");

function window(index: number, name: string, packageName: string | null): WindowInfo {
  return { index, name, packageName, activity: null };
}

const WINDOWS: WindowInfo[] = [
  window(0, "Window{1 u0 com.other/com.other.Other}", "com.other"),
  window(1, "Window{2 u0 com.example/com.example.MainActivity}", "com.example"),
  window(2, "PopupWindow:3f2a1b4", "com.example"),
];

/** A capture whose view source holds two windows, the first one primary. */
function multiWindowCapture(): CaptureResult {
  const base = loadFixtureCapture();
  const primary = makeTestNode({
    className: "android.widget.TextView",
    shortClassName: "TextView",
    text: "主窗口",
  });
  const dialogNode = makeTestNode({
    className: "android.widget.Button",
    shortClassName: "Button",
    text: "确定",
    clickable: true,
    children: [makeTestNode({ text: "取消", clickable: true })],
  });
  return {
    ...base,
    sources: ["view"],
    // Drop the semantics tree so payload stats only count the two windows.
    semantics: undefined,
    target: { ...base.target, selectedWindow: "MainActivity" },
    view: {
      window: "MainActivity",
      roots: [primary],
      captureMs: 12,
      windows: [
        { name: "MainActivity", roots: [primary], selected: true },
        { name: "PopupWindow:3f2a1b4", roots: [dialogNode] },
      ],
    },
  };
}

test("window=all orders the app's windows before other packages", () => {
  const ordered = chooseWindows(WINDOWS, CAPTURE_ALL_WINDOWS, "com.example");
  assert.deepEqual(ordered.map((w) => w.index), [1, 2, 0]);
  // The same order is the default for a single-window capture.
  assert.deepEqual(
    chooseWindows(WINDOWS, undefined, "com.example").map((w) => w.index),
    [1, 2, 0],
  );
});

test("window=<index> and window=<substring> stay single-window selectors", () => {
  assert.deepEqual(chooseWindows(WINDOWS, "2", "com.example").map((w) => w.index), [2]);
  assert.deepEqual(chooseWindows(WINDOWS, "Popup", "com.example").map((w) => w.index), [2]);
  assert.throws(() => chooseWindows(WINDOWS, "9", "com.example"), /does not exist/);
  assert.throws(() => chooseWindows(WINDOWS, "nope", "com.example"), /No window matches/);
});

test("dump_ui json lists every window and does not restate the primary tree", () => {
  const payload = buildDumpUiPayload(multiWindowCapture(), { maxNodes: 50 }) as Record<string, any>;
  assert.equal(payload.view.window, "MainActivity");
  assert.equal("roots" in payload.view, false, "roots would duplicate windows[0]");
  assert.equal(payload.view.windows.length, 2);
  assert.equal(payload.view.windows[0].name, "MainActivity");
  assert.equal(payload.view.windows[0].selected, true);
  assert.equal("selected" in payload.view.windows[1], false);
  assert.equal(payload.view.windows[0].roots[0].text, "主窗口");
  assert.equal(payload.view.windows[1].roots[0].text, "确定");
});

test("a single-window payload keeps the old view.roots shape", () => {
  const base = loadFixtureCapture();
  const payload = buildDumpUiPayload(base, { maxNodes: 50 }) as Record<string, any>;
  assert.ok(Array.isArray(payload.view.roots));
  assert.equal("windows" in payload.view, false);
});

test("window=all shares one node budget across windows", () => {
  const payload = buildDumpUiPayload(multiWindowCapture(), { maxNodes: 2 }) as Record<string, any>;
  const serialized = JSON.stringify(payload.view.windows);
  assert.equal((serialized.match(/"truncated":true/g) ?? []).length, 1, "the second window is cut");
  assert.equal(payload.view.windows.length, 2, "the truncated window is still listed");
});

test("compact payload projects each window separately", () => {
  const payload = buildCompactPayload(multiWindowCapture(), { format: "compact", maxNodes: 50 }) as Record<string, any>;
  assert.equal("nodes" in payload.view, false);
  assert.equal(payload.view.windows.length, 2);
  assert.equal(payload.view.windows[0].nodes[0].text, "主窗口");
  assert.equal(payload.view.windows[1].nodes[0].flags[0], "click");
  const stats = payload.stats as { kept: number };
  assert.equal(stats.kept, 3);
});

test("the dump file lists windows instead of duplicating roots", () => {
  const dump = serializeDump(multiWindowCapture(), false);
  assert.ok(dump.view);
  assert.equal("roots" in dump.view, false);
  assert.equal(dump.view.windows?.length, 2);
  assert.equal(dump.view.windows?.[0].selected, true);
  assert.equal(dump.view.windows?.[1].name, "PopupWindow:3f2a1b4");
});

test("the text tree names each captured window", () => {
  const text = renderCapture(multiWindowCapture(), "view");
  assert.match(text, /view windows: 2 \(primary: MainActivity/);
  assert.match(text, /primary: MainActivity/);
  assert.match(text, /window: PopupWindow:3f2a1b4/);
  assert.match(text, /主窗口/);
  assert.match(text, /确定/);
});

test("dump_ui documents window=all and returns it under view.windows", () => {
  const block = mcpSource.slice(
    mcpSource.indexOf('"dump_ui"'),
    mcpSource.indexOf('"find_elements"'),
  );
  assert.match(block, /window=all captures every window/);
  assert.match(block, /"all" for every window/);
  assert.match(block, /Android repos only; non-Android: call only on an explicit device\/screen request or Android mention\./);
});
test("find_elements and hit_test forward a window selector", () => {
  for (const [name, next] of [
    ["find_elements", "locate_code"],
    ["hit_test", "analyze_ui"],
  ] as const) {
    const block = mcpSource.slice(mcpSource.indexOf(`"${name}"`), mcpSource.indexOf(`"${next}"`));
    assert.match(block, /window: z/, `${name} should expose window`);
    assert.match(block, /window: args\.window/, `${name} should pass window to the capture`);
  }
});
