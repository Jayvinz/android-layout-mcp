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
