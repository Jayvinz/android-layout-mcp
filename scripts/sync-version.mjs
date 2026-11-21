#!/usr/bin/env node
/**
 * package.json is the source of truth for the plugin version.
 *
 * Claude Code reads a literal version from .claude-plugin/plugin.json, so the
 * manifest cannot reference package.json at runtime. This script keeps them
 * in sync at release time:
 *
 *   node scripts/sync-version.mjs          # write package.json version into plugin.json
 *   node scripts/sync-version.mjs --check  # fail if the two versions differ
 *
 * `npm version patch|minor|major` runs the "version" lifecycle script, which
 * calls this file and stages the updated plugin manifest for npm's release commit.
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_PATH = join(ROOT, "package.json");
const PLUGIN_PATH = join(ROOT, ".claude-plugin", "plugin.json");
const checkOnly = process.argv.includes("--check");

async function readText(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    console.error(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

function parseJson(text, path) {
  try {
    return JSON.parse(text);
  } catch (error) {
    console.error(`Cannot parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

const packageText = await readText(PACKAGE_PATH);
const pluginText = await readText(PLUGIN_PATH);
const pkg = parseJson(packageText, PACKAGE_PATH);
const plugin = parseJson(pluginText, PLUGIN_PATH);

if (typeof pkg.version !== "string" || pkg.version.length === 0) {
  console.error("package.json has no version.");
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(pkg.version)) {
  console.error(`package.json version "${pkg.version}" is not a valid semantic version.`);
  process.exit(1);
}

if (plugin.version === pkg.version) {
  console.log(`versions match: ${pkg.version}`);
  process.exit(0);
}

if (checkOnly) {
  console.error(
    `Version mismatch: package.json is ${pkg.version}, .claude-plugin/plugin.json is ${plugin.version ?? "<missing>"}. ` +
      "Run `node scripts/sync-version.mjs` or `npm version ...`.",
  );
  process.exit(1);
}

plugin.version = pkg.version;
const versionLine = /"version"\s*:\s*"[^"]*"/;
if (versionLine.test(pluginText)) {
  // Replace only the version value so the manifest keeps its hand-written layout.
  await writeFile(PLUGIN_PATH, pluginText.replace(versionLine, `"version": "${pkg.version}"`), "utf8");
} else {
  await writeFile(PLUGIN_PATH, `${JSON.stringify(plugin, null, 2)}\n`, "utf8");
}
console.log(`synced .claude-plugin/plugin.json to ${pkg.version}`);
