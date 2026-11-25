#!/usr/bin/env node
/**
 * Builds the distributable Claude Code plugin bundle for a release.
 *
 * The archive is the plugin folder itself (`.claude-plugin/plugin.json` at the
 * archive root), so it can be loaded with `claude --plugin-dir ./android-layout-mcp-<version>.zip`
 * or `claude --plugin-url <release asset>` and is the shape the plugin directory
 * validates. Only runtime files are included: `dist/` is committed, `src/`,
 * tests, docs, evals, and CI files are development-only.
 *
 * Production dependencies are bundled too. Claude Code installs a plugin's npm
 * dependencies only when it copies the plugin into its cache, and only when the
 * plugin root has both `package.json` and a supported lockfile; a
 * `--plugin-dir`/`--plugin-url` archive is unpacked into a session temp folder
 * and never gets that install. Shipping `node_modules/` (plus the lockfile, so a
 * cache install stays deterministic) keeps every load path working. Pass
 * `--no-deps` for an offline build of a dependency-free bundle, which then needs
 * `npm ci --omit=dev` after unzipping.
 *
 * Dependency-free at build time is not possible here (`fflate` is already a
 * runtime dependency and gives deterministic, cross-platform output), but the
 * script needs no extra tooling such as `zip` on Windows.
 *
 *   node scripts/build-plugin-zip.mjs [--root <dir>] [--out <dir>] [--no-deps]
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Files and directory trees shipped inside the plugin bundle, in archive order. */
const INCLUDED = [
  ".claude-plugin/plugin.json",
  "dist",
  "helper/alm-compose-helper.jar",
  "helper/src",
  "hooks",
  "skills",
  "commands",
  "scripts/locate-code.mjs",
  "package.json",
  "LICENSE",
  "NOTICE",
];

function parseFlag(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

function toPosix(relativePath) {
  return relativePath.split(sep).join(posix.sep);
}

/** Collects `{ name, absolute }` entries for one repo-relative path. */
function walkRepo(relativePath, entries) {
  const absolute = join(ROOT, relativePath);
  const info = statSync(absolute);
  if (info.isDirectory()) {
    for (const entry of readdirSync(absolute).sort()) walkRepo(join(relativePath, entry), entries);
    return;
  }
  entries.push({ name: toPosix(relativePath), absolute });
}

/**
 * Collects production dependencies from a staged `npm ci` install.
 *
 * `.bin` (platform-specific shims) and symlinks are skipped: the plugin is
 * loaded by Node's resolver, never through shell shims, and a symlink cannot be
 * stored portably in the archive.
 */
function walkDependencies(staging, relativePath, entries) {
  const absolute = join(staging, relativePath);
  const info = lstatSync(absolute);
  if (info.isSymbolicLink()) return;
  if (info.isDirectory()) {
    for (const entry of readdirSync(absolute).sort()) {
      if (entry === ".bin" || entry === ".package-lock.json") continue;
      walkDependencies(staging, join(relativePath, entry), entries);
    }
    return;
  }
  entries.push({ name: toPosix(relativePath), data: readFileSync(absolute) });
}

/** Installs production dependencies into a temp stage and collects them. */
function collectDependencies(entries) {
  const staging = mkdtempSync(join(tmpdir(), "alm-plugin-deps-"));
  try {
    cpSync(join(ROOT, "package.json"), join(staging, "package.json"));
    cpSync(join(ROOT, "package-lock.json"), join(staging, "package-lock.json"));
    const npmCli = process.env.npm_execpath;
    const npmArgs = ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"];
    // `npm run` exposes the npm CLI script, which is the reliable way to spawn
    // npm with the current Node. A direct `node scripts/...` has no npm_execpath,
    // and on Windows `npm` is `npm.cmd`, which needs a shell to launch.
    const command = npmCli ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
    const args = npmCli ? [npmCli, ...npmArgs] : npmArgs;
    const result = spawnSync(command, args, {
      cwd: staging,
      stdio: "inherit",
      shell: !npmCli && process.platform === "win32",
    });
    if (result.error || result.status !== 0) {
      throw new Error(
        `npm ci --omit=dev failed (${result.error?.message ?? `exit ${result.status}`}); ` +
          "fix the network/registry or rerun with --no-deps " +
          "(that bundle needs npm ci --omit=dev after unzipping).",
      );
    }
    walkDependencies(staging, "node_modules", entries);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

const argv = process.argv.slice(2);
// `--root` bundles a different tree, such as a tag checkout, so a release asset
// can be rebuilt from exactly the tagged commit.
const ROOT = resolve(parseFlag(argv, "--root", REPO_ROOT));
const outDir = resolve(parseFlag(argv, "--out", join(REPO_ROOT, "dist-plugin")));
const includeDependencies = !argv.includes("--no-deps");
const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

const entries = [];
for (const entry of INCLUDED) walkRepo(entry, entries);
// The lockfile is what lets Claude Code reproduce the dependency set when the
// bundle is later installed into its cache.
entries.push({ name: "package-lock.json", absolute: join(ROOT, "package-lock.json") });
if (includeDependencies) collectDependencies(entries);

// A fixed timestamp keeps the archive byte-identical across rebuilds, so the
// same commit always produces the same asset hash.
const mtime = new Date(Number(process.env.SOURCE_DATE_EPOCH ?? 0) * 1000 || 315532800000);
const archive = {};
for (const entry of entries) {
  // Dependency bytes are read while the staging directory still exists; repo
  // files are read here from their absolute path.
  archive[entry.name] = [new Uint8Array(entry.data ?? readFileSync(entry.absolute)), { mtime }];
}

const zip = zipSync(archive, { level: 9 });
const zipPath = join(outDir, `android-layout-mcp-${version}.zip`);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
writeFileSync(zipPath, zip);

const sha256 = createHash("sha256").update(zip).digest("hex");
const dependencyFiles = entries.filter((entry) => entry.name.startsWith("node_modules/")).length;
console.log(`${zipPath}`);
console.log(
  `files ${entries.length}${includeDependencies ? ` (dependencies ${dependencyFiles})` : " (no dependencies)"}, ` +
    `bytes ${zip.length}, sha256 ${sha256}`,
);
