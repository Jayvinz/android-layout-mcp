import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MCP_CLIENT_IDS, mcpClientConfig } from "../src/core/mcp-config.js";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const ARGS = ["/abs/path/dist/mcp.js", "--serial", "emulator-5554"];

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

/**
 * A new client id must be reflected in every user-facing list. These tests
 * derive the expectation from MCP_CLIENT_IDS so adding a client without
 * updating the docs (or vice versa) fails the suite.
 */
const CLIENT_LIST_DOCS = [
  "README.md",
  "README.zh.md",
  "docs/mcp.md",
  "docs/mcp.zh.md",
  "docs/cross-agent.md",
  "docs/cross-agent.zh.md",
];

test("every documented client list covers all client ids", () => {
  assert.ok(MCP_CLIENT_IDS.length >= 20, "expected at least 20 configured clients");
  for (const doc of CLIENT_LIST_DOCS) {
    const source = read(doc);
    const missing = MCP_CLIENT_IDS.filter((id) => !source.includes(`\`${id}\``));
    assert.deepEqual(missing, [], `${doc} does not list: ${missing.join(", ")}`);
  }
});

test("the compatibility guide documents the same client count as the code", () => {
  const count = MCP_CLIENT_IDS.length;
  for (const doc of ["AGENTS.md", "docs/cross-agent.md", "docs/cross-agent.zh.md"]) {
    const source = read(doc);
    assert.match(
      source,
      new RegExp(`\\b${count} (clients|client ids|个客户端)`),
      `${doc} should state the current client count (${count})`,
    );
  }
});

test("the CLI derives its --client choices from the shared id list", () => {
  const cli = read("src/cli.ts");
  assert.match(
    cli,
    /new Option\("--client <id>"[\s\S]*?\.choices\(\[\s*\.\.\.MCP_CLIENT_IDS,?\s*\]\)/,
    "the CLI must spread MCP_CLIENT_IDS into --client choices instead of hard-coding ids",
  );
  assert.ok(!/choices\(\[\s*"claude"/.test(cli), "client ids must not be duplicated in the CLI");
});

test("every config family keeps its documented envelope", () => {
  // Family -> expected shape. Derived from src/core/mcp-config.ts and mirrored
  // in docs/cross-agent.md; a change here means the docs must change too.
  const jsonFamilies = ["claude", "claude-desktop", "codebuddy", "workbuddy", "cursor", "windsurf", "devin", "cline", "kiro", "gemini", "antigravity", "qwen", "trae", "generic"] as const;
  const configOf = (id: (typeof MCP_CLIENT_IDS)[number]) => mcpClientConfig(id, "node", ARGS);

  for (const id of jsonFamilies) {
    const config = configOf(id);
    assert.equal(config.format, "json", `${id} should produce JSON`);
    const parsed = JSON.parse(config.content) as Record<string, unknown>;
    assert.ok("mcpServers" in parsed, `${id} envelope must have an mcpServers key`);
  }

  const vscode = JSON.parse(configOf("vscode").content) as Record<string, Record<string, { type: string }>>;
  assert.equal(vscode.servers["android-layout"].type, "stdio");

  const zed = JSON.parse(configOf("zed").content) as Record<string, Record<string, { command: { path: string } }>>;
  assert.equal(zed.context_servers["android-layout"].command.path, "node");

  const opencode = JSON.parse(configOf("opencode").content) as Record<string, Record<string, { type: string }>>;
  assert.equal(opencode.mcp["android-layout"].type, "local");

  const amp = JSON.parse(configOf("amp").content) as Record<string, unknown>;
  assert.ok("amp.mcpServers" in amp);

  assert.equal(configOf("codex").format, "toml");
  assert.equal(configOf("goose").format, "yaml");

  const covered = new Set<string>([
    ...jsonFamilies,
    "vscode",
    "zed",
    "opencode",
    "amp",
    "codex",
    "goose",
  ]);
  const unclassified = MCP_CLIENT_IDS.filter((id) => !covered.has(id));
  assert.deepEqual(unclassified, [], `families not covered by this contract: ${unclassified.join(", ")}`);
});

test("the sync script advertises every flag the docs mention", () => {
  const script = read("scripts/sync-agent-skills.mjs");
  for (const flag of ["--dest", "--global", "--codebuddy", "--workbuddy", "--both", "--check", "--dry-run"]) {
    assert.ok(script.includes(`"${flag}"`), `sync script is missing the ${flag} flag`);
  }
  for (const doc of ["docs/cross-agent.md", "docs/cross-agent.zh.md"]) {
    const source = read(doc);
    for (const flag of ["--dest", "--global", "--codebuddy", "--workbuddy", "--both", "--check"]) {
      assert.ok(source.includes(flag), `${doc} does not document ${flag}`);
    }
  }
});

test("--both writes agents + codebuddy only; --workbuddy adds the third target", () => {
  const dest = mkdtempSync(join(tmpdir(), "aui-compat-both-"));
  const script = join(repoRoot, "scripts", "sync-agent-skills.mjs");
  const run = (flags: string[]) =>
    spawnSync(process.execPath, [script, "--dest", dest, ...flags], { encoding: "utf8" });
  try {
    const both = run(["--both"]);
    assert.equal(both.status, 0, both.stderr);

    assert.ok(existsSync(join(dest, ".agents", "skills")), "--both must write .agents/skills");
    assert.ok(existsSync(join(dest, ".codebuddy", "skills")), "--both must write .codebuddy/skills");
    assert.ok(!existsSync(join(dest, ".workbuddy", "skills")), "--both must not write .workbuddy/skills");

    const all = run(["--both", "--workbuddy"]);
    assert.equal(all.status, 0, all.stderr);
    assert.ok(existsSync(join(dest, ".workbuddy", "skills")), "--both --workbuddy must write all three");

    const check = run(["--both", "--workbuddy", "--check"]);
    assert.equal(check.status, 0, check.stderr);
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("the skill directory matrix matches the shipped skills", () => {
  const skillsRoot = join(repoRoot, "skills");
  const skillNames = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(skillsRoot, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual(
    skillNames,
    ["audit-ui", "capture-ui", "inspect-view-attribute", "trace-ui-logic", "trace-view-wiring"],
    "the documented five skills changed; update docs/cross-agent.md and both READMEs",
  );

  for (const doc of ["docs/cross-agent.md", "docs/cross-agent.zh.md"]) {
    const source = read(doc);
    for (const dir of [".agents/skills", ".codebuddy/skills", ".workbuddy/skills", ".claude/skills"]) {
      assert.ok(source.includes(dir), `${doc} must document ${dir}`);
    }
  }
});

test("the verified client matrix in the docs stays in sync with its guide", () => {
  const verified = ["OpenCode", "CodeBuddy", "Codex CLI", "WorkBuddy"];
  for (const doc of ["docs/mcp.md", "docs/mcp.zh.md", "docs/cross-agent.md", "docs/cross-agent.zh.md"]) {
    const source = read(doc);
    for (const client of verified) {
      assert.ok(source.includes(client), `${doc} is missing verified client ${client}`);
    }
  }
  // Verified clients must be real ids (or a documented alias of one).
  const aliases: Record<string, string[]> = {
    "CodeBuddy": ["codebuddy"],
    "Codex CLI": ["codex"],
    "WorkBuddy": ["workbuddy"],
    "OpenCode": ["opencode"],
  };
  for (const [label, ids] of Object.entries(aliases)) {
    assert.ok(ids.some((id) => MCP_CLIENT_IDS.includes(id as (typeof MCP_CLIENT_IDS)[number])), `${label} has no client id`);
  }
});
