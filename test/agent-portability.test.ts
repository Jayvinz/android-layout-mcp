import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const skillsRoot = join(repoRoot, "skills");

const skillNames = readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(skillsRoot, entry.name, "SKILL.md")))
  .map((entry) => entry.name)
  .sort();

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

function frontmatter(source: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  assert.ok(match, "expected a YAML frontmatter block");
  return match[1];
}

function descriptionOf(source: string): string {
  const lines = frontmatter(source).split(/\r?\n/);
  const start = lines.findIndex((line) => /^description:\s*/.test(line));
  assert.notEqual(start, -1, 'expected a "description" field');
  const parts = [lines[start].replace(/^description:\s*/, "").replace(/^>-?$/, "")];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^[a-zA-Z_-]+:/.test(lines[i])) break;
    parts.push(lines[i]);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

test("skills export only the portable frontmatter fields", () => {
  for (const name of skillNames) {
    const source = read(`skills/${name}/SKILL.md`);
    const keys = [...frontmatter(source).matchAll(/^([a-zA-Z_-]+):/gm)].map((match) => match[1]);
    for (const key of keys) {
      assert.ok(
        ["name", "description"].includes(key),
        `${name}: "${key}" is not part of the portable Agent Skills subset`,
      );
    }
    assert.match(frontmatter(source), new RegExp(`^name: ${name}$`, "m"), `${name}: name must match its folder`);
    const description = descriptionOf(source);
    assert.ok(description.length > 0, `${name}: description is empty`);
    assert.ok(description.length <= 1024, `${name}: description is ${description.length} chars, the limit is 1024`);
  }
});

test("skills never hard-code the Claude Code plugin root in a command", () => {
  for (const name of skillNames) {
    const source = read(`skills/${name}/SKILL.md`);
    assert.doesNotMatch(
      source,
      /\$\{CLAUDE_PLUGIN_ROOT\}\/(dist|scripts)\//,
      `${name}: executable paths must use $ALM_ROOT so other agents can resolve them`,
    );
    if (source.includes("dist/cli.js")) {
      assert.ok(source.includes("`ALM_ROOT`"), `${name}: document what ALM_ROOT points at`);
    }
  }
  const reference = read("skills/trace-view-wiring/references/output-template.md");
  assert.doesNotMatch(reference, /\$\{CLAUDE_PLUGIN_ROOT\}\/(dist|scripts)\//);
});

test("sync-agent-skills installs an identical, check-clean copy", () => {
  const dest = mkdtempSync(join(tmpdir(), "alm-skills-"));
  const script = join(repoRoot, "scripts", "sync-agent-skills.mjs");
  try {
    const copy = spawnSync(process.execPath, [script, "--dest", dest], { encoding: "utf8" });
    assert.equal(copy.status, 0, copy.stderr);

    const installed = join(dest, ".agents", "skills");
    for (const name of skillNames) {
      const source = readFileSync(join(skillsRoot, name, "SKILL.md"), "utf8");
      const copied = readFileSync(join(installed, name, "SKILL.md"), "utf8");
      assert.equal(copied, source, `${name}: copied SKILL.md differs from the plugin copy`);
    }

    const clean = spawnSync(process.execPath, [script, "--dest", dest, "--check"], { encoding: "utf8" });
    assert.equal(clean.status, 0, clean.stderr);

    appendFileSync(join(installed, skillNames[0], "SKILL.md"), "\nlocal edit\n");
    const dirty = spawnSync(process.execPath, [script, "--dest", dest, "--check"], { encoding: "utf8" });
    assert.equal(dirty.status, 1, "a modified copy must fail the check");
    assert.match(dirty.stderr, /differs/);
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("sync-agent-skills can target CodeBuddy's .codebuddy/skills", () => {
  const dest = mkdtempSync(join(tmpdir(), "alm-codebuddy-skills-"));
  const script = join(repoRoot, "scripts", "sync-agent-skills.mjs");
  try {
    const missing = spawnSync(process.execPath, [script, "--dest", dest, "--codebuddy", "--check"], {
      encoding: "utf8",
    });
    assert.equal(missing.status, 1, "an empty CodeBuddy target must fail the check");

    const copy = spawnSync(process.execPath, [script, "--dest", dest, "--codebuddy"], { encoding: "utf8" });
    assert.equal(copy.status, 0, copy.stderr);

    for (const name of skillNames) {
      assert.ok(existsSync(join(dest, ".codebuddy", "skills", name, "SKILL.md")), `${name} was not copied`);
      assert.ok(!existsSync(join(dest, ".agents", "skills", name)), `${name} should not be copied to .agents`);
    }

    const clean = spawnSync(process.execPath, [script, "--dest", dest, "--codebuddy", "--check"], {
      encoding: "utf8",
    });
    assert.equal(clean.status, 0, clean.stderr);

    const both = spawnSync(process.execPath, [script, "--dest", dest, "--both"], { encoding: "utf8" });
    assert.equal(both.status, 0, both.stderr);
    const bothCheck = spawnSync(process.execPath, [script, "--dest", dest, "--both", "--check"], {
      encoding: "utf8",
    });
    assert.equal(bothCheck.status, 0, bothCheck.stderr);

    const wbCopy = spawnSync(process.execPath, [script, "--dest", dest, "--workbuddy"], {
      encoding: "utf8",
    });
    assert.equal(wbCopy.status, 0, wbCopy.stderr);
    for (const name of skillNames) {
      assert.ok(existsSync(join(dest, ".workbuddy", "skills", name, "SKILL.md")), `${name} was not copied`);
    }
    const wbCheck = spawnSync(process.execPath, [script, "--dest", dest, "--workbuddy", "--check"], {
      encoding: "utf8",
    });
    assert.equal(wbCheck.status, 0, wbCheck.stderr);
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});
