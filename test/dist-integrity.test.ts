import { test } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distRoot = join(repoRoot, "dist");
const srcRoot = join(repoRoot, "src");

/**
 * `dist/` is committed and shipped in the plugin bundle, but `tsc` never
 * deletes the output of a module whose source was removed. That left
 * `dist/core/{diff,viewer}.js` behind after those features were deleted, so the
 * plugin kept publishing dead code. Every compiled file must have a source.
 */
function compiledFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...compiledFiles(full));
    else if (/\.(js|d\.ts)$/.test(entry.name)) found.push(full);
  }
  return found;
}

test("every compiled dist file has a matching src module", () => {
  const orphans = compiledFiles(distRoot)
    .map((full) => full.slice(distRoot.length + 1).replace(/\\/g, "/"))
    .map((relative) => relative.replace(/\.d\.ts$/, ".ts").replace(/\.js$/, ".ts"))
    .filter((relative) => !existsSync(join(srcRoot, relative)));

  assert.deepEqual(
    orphans,
    [],
    `orphan build output (source removed but dist kept): ${orphans.join(", ")}`,
  );
});

test("the removed diff and viewer modules are not still shipped", () => {
  for (const name of ["diff", "viewer"]) {
    for (const extension of ["js", "d.ts"]) {
      const path = join(distRoot, "core", `${name}.${extension}`);
      assert.equal(existsSync(path), false, `${path} should not exist; the feature was deleted`);
    }
  }
});

test("dist re-exports only modules that still exist", async () => {
  // `dist/core/index.js` re-exports the core surface; an export of a deleted
  // module would throw at import time for every consumer.
  const index = await import(new URL("../dist/core/index.js", import.meta.url).href);
  assert.equal(typeof index.capture, "function");
  assert.equal(typeof index.analyzeCapture, "function");
  assert.equal("writeViewer" in index, false, "the viewer writer was deleted");
});