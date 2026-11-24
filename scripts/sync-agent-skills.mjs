#!/usr/bin/env node
/**
 * Copy the plugin's skills into the skill directory used by other agents.
 *
 * `skills/` at the repository root is the Claude Code plugin layout. Codex CLI,
 * Gemini CLI, Cline, and Goose read `.agents/skills/`; CodeBuddy reads
 * `.codebuddy/skills/` (Cursor and VS Code read `.claude/skills/` directly,
 * so they need no copy). This script installs the same unchanged SKILL.md files
 * into the chosen target(s), into another project with `--dest`, or once per
 * user with `--global`.
 *
 * The skills use only `name` + `description` frontmatter, which is the portable
 * part of the Agent Skills standard, so nothing is rewritten.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const skillsRoot = join(repoRoot, "skills");

const usage = `usage: node scripts/sync-agent-skills.mjs [--dest <dir>] [--global] [--codebuddy | --both] [--check] [--dry-run]

  --dest <dir>  project to install into (default: current directory)
  --global      install for the current user
  --codebuddy   write .codebuddy/skills instead of .agents/skills
  --both        write both .agents/skills and .codebuddy/skills
  --check       report differences and exit 1 when a target is stale
  --dry-run     print what would be copied without writing`;

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
let dest = process.cwd();
let destGiven = false;
let global = false;
let codebuddy = false;
let both = false;
let check = false;
let dryRun = false;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--help" || arg === "-h") {
    console.log(usage);
    process.exit(0);
  } else if (arg === "--global") {
    global = true;
  } else if (arg === "--codebuddy") {
    codebuddy = true;
  } else if (arg === "--both") {
    both = true;
  } else if (arg === "--check") {
    check = true;
  } else if (arg === "--dry-run") {
    dryRun = true;
  } else if (arg === "--dest" || arg.startsWith("--dest=")) {
    const value = arg === "--dest" ? args[++i] : arg.slice("--dest=".length);
    if (!value || value.startsWith("--")) fail("--dest needs a directory");
    dest = value;
    destGiven = true;
  } else {
    fail(`unknown argument "${arg}"\n\n${usage}`);
  }
}

if (global && destGiven) fail("--global and --dest are mutually exclusive");
if (codebuddy && both) fail("--codebuddy and --both are mutually exclusive");
if (!existsSync(skillsRoot)) fail(`no skills directory at ${skillsRoot}`);

const variants = both ? ["agents", "codebuddy"] : [codebuddy ? "codebuddy" : "agents"];
const targets = variants.map((variant) => ({
  variant,
  root: global ? join(homedir(), `.${variant}`, "skills") : join(resolve(dest), `.${variant}`, "skills"),
}));

const skills = readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(skillsRoot, entry.name, "SKILL.md")))
  .map((entry) => entry.name)
  .sort();

if (skills.length === 0) fail(`no SKILL.md found under ${skillsRoot}`);

/** Files under one skill, relative to the skills root (POSIX separators). */
function filesOf(skill) {
  const out = [];
  const walk = (relative) => {
    for (const entry of readdirSync(join(skillsRoot, relative), { withFileTypes: true })) {
      const child = join(relative, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) out.push(child.split(sep).join("/"));
    }
  };
  walk(skill);
  return out;
}

function flags() {
  return [
    global ? " --global" : "",
    codebuddy ? " --codebuddy" : "",
    both ? " --both" : "",
    destGiven ? ` --dest ${resolve(dest)}` : "",
  ].join("");
}

if (check) {
  const stale = [];
  for (const { variant, root } of targets) {
    for (const skill of skills) {
      for (const relative of filesOf(skill)) {
        const source = join(skillsRoot, relative);
        const target = join(root, relative);
        if (!existsSync(target) || !statSync(target).isFile()) {
          stale.push(`${variant}: missing  ${relative}`);
        } else if (!readFileSync(source).equals(readFileSync(target))) {
          stale.push(`${variant}: differs  ${relative}`);
        }
      }
    }
  }
  if (stale.length > 0) {
    console.error("skill copies are out of date:");
    for (const line of stale) console.error(`  ${line}`);
    console.error(`\nRun: node scripts/sync-agent-skills.mjs${flags()}`);
    process.exit(1);
  }
  console.log(`${targets.map((target) => target.root).join(" and ")} are up to date (${skills.length} skills)`);
  process.exit(0);
}

if (dryRun) {
  for (const { root } of targets) {
    console.log(`would copy ${skills.length} skills to ${root}:`);
    for (const skill of skills) console.log(`  ${skill}/ (${filesOf(skill).length} files)`);
  }
  process.exit(0);
}

for (const { root } of targets) {
  mkdirSync(root, { recursive: true });
  let count = 0;
  for (const skill of skills) {
    cpSync(join(skillsRoot, skill), join(root, skill), { recursive: true, force: true });
    count += filesOf(skill).length;
  }
  console.log(`copied ${skills.length} skills (${count} files) to ${root}`);
}
console.log(`  ${skills.join(", ")}`);

if (!global) {
  const dirs = targets.map((target) => `.${target.variant}/skills`).join(" and ");
  console.log(
    `\nCommit ${dirs} in that project, and point AUI_ROOT at this checkout ` +
      `(or put the android-ui CLI on PATH) so the skills' CLI fallback resolves.`,
  );
}
