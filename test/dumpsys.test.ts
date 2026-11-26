import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  allFragments,
  mergeSemanticsText,
  notableFragments,
  parseDumpsys,
} from "../src/core/dumpsys.js";
import { parseSemanticsXml } from "../src/core/semantics.js";
import { flattenNodes, intersect } from "../src/core/viewdump.js";

const dumpsys = readFileSync(new URL("./fixtures/dumpsys-activity.txt", import.meta.url), "utf8");
const semantics = readFileSync(new URL("./fixtures/semantics-studymixed.xml", import.meta.url), "utf8");
const screen = { width: 1080, height: 2400, density: 2.75, densityDpi: 440 } as const;

function parse() {
  return parseDumpsys(dumpsys, { packageName: "com.example.studymixed", screen });
}

test("parses the dumpsys view hierarchy into a tree", () => {
  const parsed = parse();
  assert.equal(parsed.activities.length, 1);
  assert.equal(parsed.activity, "com.example.studymixed/.EntryActivity");
  assert.equal(parsed.roots.length, 1);

  const root = parsed.roots[0];
  assert.equal(root.className, "com.android.internal.policy.DecorView");
  // The DecorView line carries no bounds of its own; it inherits the screen.
  assert.equal(root.bounds.width, 1080);
  assert.equal(root.bounds.height, 2400);
  assert.ok(root.children.length > 0);
});

test("keeps absolute bounds, resource ids, and real class names", () => {
  const nodes = flattenNodes(parse().roots);
  const button = nodes.find((node) => node.resourceId === "app:id/btnXml");
  assert.ok(button, "expected the btnXml button");
  assert.equal(button.className, "com.google.android.material.button.MaterialButton");
  assert.equal(button.shortClassName, "MaterialButton");
  assert.deepEqual(
    { left: button.bounds.left, top: button.bounds.top, right: button.bounds.right, bottom: button.bounds.bottom },
    { left: 66, top: 352, right: 1014, bottom: 484 },
  );
});

test("reads view flags from the right positions", () => {
  const nodes = flattenNodes(parse().roots);
  const button = nodes.find((node) => node.resourceId === "app:id/btnXml");
  assert.ok(button);
  // `VFED..C..` — visible, focusable, enabled, clickable.
  assert.equal(button.visible, true);
  assert.equal(button.enabled, true);
  assert.equal(button.clickable, true);

  const stub = nodes.find((node) => node.resourceId === "android:id/action_mode_bar_stub");
  assert.ok(stub);
  // `G.E......` — gone, so neither visible nor sized.
  assert.equal(stub.visible, false);
  assert.equal(stub.visibleBounds, null);
});

test("assigns d-prefixed refs so they cannot be mistaken for other sources", () => {
  const nodes = flattenNodes(parse().roots);
  assert.equal(nodes[0].ref, "d0");
  for (const node of nodes) {
    assert.match(node.ref, /^d\d+$/);
    assert.equal(node.source, "dumpsys");
  }
  const refs = new Set(nodes.map((node) => node.ref));
  assert.equal(refs.size, nodes.length, "refs must be unique");
});

test("dumpsys carries no text of its own", () => {
  const nodes = flattenNodes(parse().roots);
  assert.equal(nodes.filter((node) => node.text).length, 0);
});

test("parses fragment records with state and flags", () => {
  const parsed = parse();
  assert.ok(parsed.fragments.length > 0, "expected at least one fragment");
  const report = parsed.fragments.find((fragment) =>
    /report_fragment_tag/.test(fragment.tag ?? ""),
  );
  assert.ok(report, "expected the lifecycle ReportFragment");
  assert.equal(report.className, "ReportFragment");
  assert.equal(report.state, 5);
  assert.equal(report.added, true);
  assert.equal(report.hidden, false);
  assert.equal(report.detached, false);
});

test("filters AndroidX lifecycle bookkeeping out of the notable list", () => {
  const parsed = parse();
  const all = allFragments(parsed);
  const notable = notableFragments(all);
  assert.ok(all.length > 0);
  assert.equal(notable.length, 0, "the fixture only has framework fragments");
  for (const fragment of all) {
    assert.match(fragment.tag ?? fragment.className ?? "", /ReportFragment|report_fragment_tag/);
  }
});

test("merges semantics text onto dumpsys nodes across the coordinate offset", () => {
  const parsed = parse();
  const parsedSemantics = parseSemanticsXml(semantics, "com.example.studymixed");
  const before = flattenNodes(parsed.roots).filter((node) => node.text).length;
  const merged = mergeSemanticsText(parsed.roots, parsedSemantics.roots, { screen });
  assert.equal(before, 0);
  assert.ok(merged.labelled > 0, "expected text to be merged");
  const after = flattenNodes(parsed.roots).filter((node) => node.text).length;
  assert.equal(after, merged.labelled);

  // The merged node keeps the dumpsys class and id but gains the text.
  const button = flattenNodes(parsed.roots).find((node) => node.resourceId === "app:id/btnXml");
  assert.ok(button);
  assert.equal(button.className, "com.google.android.material.button.MaterialButton");
});

test("does not merge text from a geometry that only partially overlaps", () => {
  const parsed = parse();
  const parsedSemantics = parseSemanticsXml(semantics, "com.example.studymixed");
  // Shifting the semantics tree by half the screen makes every rect unique but
  // non-identical, so nothing may be attached.
  for (const node of flattenNodes(parsedSemantics.roots)) {
    node.bounds = { ...node.bounds, top: node.bounds.top + 1200, bottom: node.bounds.bottom + 1200 };
    if (node.visibleBounds) {
      node.visibleBounds = {
        ...node.visibleBounds,
        top: node.visibleBounds.top + 1200,
        bottom: node.visibleBounds.bottom + 1200,
      };
    }
  }
  const merged = mergeSemanticsText(parsed.roots, parsedSemantics.roots, { screen });
  assert.equal(merged.labelled, 0);
});

test("rejects a dump with no activity block", () => {
  const parsed = parseDumpsys("Can't find service: activity", { packageName: "com.example.x" });
  assert.equal(parsed.roots.length, 0);
  assert.equal(parsed.activities.length, 0);
});
test("sorts a transposed dumpsys bounds rect", () => {
  // A transposed rect (left>right) must be normalized, not turned into a
  // negative width that would poison visibleBounds and the analysis rules.
  const transposed = dumpsys.replace("66,352-1014,484", "1014,484-66,352");
  const parsed = parseDumpsys(transposed, { packageName: "com.example.studymixed", screen });
  const button = flattenNodes(parsed.roots).find((node) => node.resourceId === "app:id/btnXml");
  assert.ok(button, "expected the btnXml button");
  assert.deepEqual(
    { left: button.bounds.left, top: button.bounds.top, right: button.bounds.right, bottom: button.bounds.bottom },
    { left: 66, top: 352, right: 1014, bottom: 484 },
  );
  assert.equal(button.bounds.width, 948);
  assert.equal(button.bounds.height, 132);
});
