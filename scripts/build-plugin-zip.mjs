#!/usr/bin/env node
/**
 * Builds the distributable Claude Code plugin bundle for a release.
 *
 * The archive is the plugin folder itself (`.claude-plugin/plugin.json` at the
 * archive root), so it can be loaded with `claude --plugin-dir ./android-ui.zip`
 * or `claude --plugin-url <release asset>` and is the shape the plugin directory
 * validates. Only runtime files are included: `dist/` is committed, `src/`,
 * tests, docs, evals, and CI files are development-only.
 *
 * Dependency-free at build time is not possible here (`fflate` is already a
 * runtime dependency and gives deterministic, cross-platform output), but the
 * script needs no extra tooling such as `zip` on Windows.
 *
 *   node scripts/build-plugin-zip.mjs [--root <dir>] [--out <dir>]
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, posix, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Files and directory trees shipped inside the plugin bundle, in archive order. */
const INCLUDED = [
  ".claude-plugin/plugin.json",
  "dist",
  "helper/aui-compose-helper.jar",
  "helper/src",
  "hooks",
  "skills",
  "commands",
  "agents",
  "scripts/locate-code.mjs",
  "package.json",
  "README.md",
  "README.zh.md",
  "LICENSE",
  "NOTICE",
];

function parseFlag(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

function walk(relativePath, files) {
  const absolute = join(ROOT, relativePath);
  const info = statSync(absolute);
  if (info.isDirectory()) {
    for (const entry of readdirSync(absolute).sort()) walk(join(relativePath, entry), files);
    return;
  }
  files.push(relativePath.split(sep).join(posix.sep));
}

const argv = process.argv.slice(2);
// `--root` bundles a different tree, such as a tag checkout, so a release asset
// can be rebuilt from exactly the tagged commit.
const ROOT = resolve(parseFlag(argv, "--root", REPO_ROOT));
const outDir = resolve(parseFlag(argv, "--out", join(REPO_ROOT, "dist-plugin")));
const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

const files = [];
for (const entry of INCLUDED) walk(entry, files);

// A fixed timestamp keeps the archive byte-identical across rebuilds, so the
// same commit always produces the same asset hash.
const mtime = new Date(Number(process.env.SOURCE_DATE_EPOCH ?? 0) * 1000 || 315532800000);
const archive = {};
for (const file of files) {
  archive[file] = [new Uint8Array(readFileSync(join(ROOT, file))), { mtime }];
}

const zip = zipSync(archive, { level: 9 });
const zipPath = join(outDir, `android-ui-${version}.zip`);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
writeFileSync(zipPath, zip);

const sha256 = createHash("sha256").update(zip).digest("hex");
console.log(`${zipPath}`);
console.log(`files ${files.length}, bytes ${zip.length}, sha256 ${sha256}`);
