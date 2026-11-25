import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadFixtureCapture } from "./fixtures.js";
import { serializeNode } from "../src/core/viewdump.js";
import { loadDump, saveDump, serializeDump } from "../src/core/serialize.js";
import type { DumpFile } from "../src/core/model.js";

const capture = loadFixtureCapture();

test("serialises a capture into a versioned dump", () => {
  const dump = serializeDump(capture, true);
  assert.equal(dump.version, 1);
  assert.equal(dump.source, "view");
  assert.deepEqual(dump.sources, ["view", "semantics"]);
  assert.ok(dump.view);
  assert.ok(dump.semantics);
  assert.equal(dump.view!.roots.length, 1);
  assert.equal(dump.semantics!.roots.length, 1);
  assert.ok(JSON.stringify(dump).length > 1000);
});

test("dump round-trips through disk and exposes both sources", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alm-test-"));
  try {
    const path = join(dir, "nested", "deeper", "dump.json");
    await saveDump(capture, path);
    const loaded = await loadDump(path);
    assert.equal(loaded.view?.roots.length, 1);
    assert.equal(loaded.semantics?.roots.length, 1);
    assert.equal(loaded.screen.width, 1080);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("serializeNode can bound the total number of nodes", () => {
  const roots = capture.view!.roots;
  const counter = { value: 0 };
  const tree = serializeNode(roots[0], { maxNodes: 3, counter }) as Record<string, unknown>;
  const children = tree.children as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(children));
  const stringified = JSON.stringify(tree);
  assert.match(stringified, /truncated|childrenCount/);
  assert.ok(counter.value <= 3);
});
