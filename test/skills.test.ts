import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

/** Minimal YAML frontmatter reader for the subset used by plugin components. */
function frontmatter(source: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  assert.ok(match, "expected a YAML frontmatter block");
  return match[1];
}

/**
 * Parse a scalar field from frontmatter. Handles plain/quoted one-line scalars
 * and folded block scalars (`>` / `>-`), which is all the component files use.
 */
function scalarField(source: string, field: string): string {
  const lines = frontmatter(source).split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^${field}:\\s*`).test(line));
  assert.notEqual(start, -1, `expected frontmatter field "${field}"`);

  const inline = lines[start].replace(new RegExp(`^${field}:\\s*`), "");
  if (inline === ">" || inline === ">-" || inline === "|" || inline === "|-") {
    const block: string[] = [];
    for (let i = start + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.trim() === "") {
        block.push("");
        continue;
      }
      if (!/^\s+/.test(line)) break;
      block.push(line);
    }
    const nonEmpty = block.filter((line) => line.trim() !== "");
    const indent = Math.min(...nonEmpty.map((line) => /^\s*/.exec(line)?.[0].length ?? 0));
    const values = block.map((line) => (line.trim() === "" ? "" : line.slice(indent)));
    if (inline.endsWith("-")) {
      return values.join(" ").replace(/\s+/g, " ").trim();
    }
    return values.join("\n").trim();
  }

  return inline.trim().replace(/^["']|["']$/g, "");
}

function assertContains(haystack: string, needles: string[], label: string): void {
  for (const needle of needles) {
    assert.ok(haystack.includes(needle), `${label} is missing "${needle}"`);
  }
}

/** The five skills, keyed by directory name. */
const SKILL_NAMES = [
  "capture-ui",
  "inspect-view-attribute",
  "trace-view-wiring",
  "trace-ui-to-logic",
  "audit-ui",
] as const;

const skills = Object.fromEntries(
  SKILL_NAMES.map((name) => [name, read(`skills/${name}/SKILL.md`)]),
) as Record<(typeof SKILL_NAMES)[number], string>;

/** The five commands, keyed by command name. */
/** Commands plus the ui2logic alias, which maps onto the same skill as trace-logic. */
const COMMAND_NAMES = ["capture", "inspect-view", "trace-view", "trace-logic", "ui2logic", "audit"] as const;

test("the shipped skill set is exactly the five designed skills", () => {
  const found = readdirSync(join(repoRoot, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(repoRoot, "skills", entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(found, [...SKILL_NAMES].sort());
});

test("the shipped command set is exactly the five designed commands", () => {
  const found = readdirSync(join(repoRoot, "commands"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.replace(/\.md$/, ""))
    .sort();
  assert.deepEqual(found, [...COMMAND_NAMES].sort());
});

test("no subagent ships: the locator is a skill, not an agent", () => {
  assert.equal(
    existsSync(join(repoRoot, "agents")),
    false,
    "agents/ must not exist; trace-view-wiring owns that workflow",
  );
});

test("every skill description fits the 1024-character limit", () => {
  for (const [name, source] of Object.entries(skills)) {
    const description = scalarField(source, "description");
    assert.ok(description.length > 0, `${name} description is empty`);
    assert.ok(
      description.length <= 1024,
      `${name} description is ${description.length} characters (max 1024)`,
    );
  }
});

test("every skill description declares what it owns and what it does not", () => {
  for (const [name, source] of Object.entries(skills)) {
    const description = scalarField(source, "description");
    assert.match(description, /Owns:/, `${name} description needs an "Owns:" clause`);
    assert.match(description, /Not:/, `${name} description needs a "Not:" clause`);
  }
});

test("every Not: clause points at a real skill", () => {
  const known = new Set<string>(SKILL_NAMES);
  for (const [name, source] of Object.entries(skills)) {
    const description = scalarField(source, "description");
    const notClause = /Not:([\s\S]*?)(?:Only in Android|$)/.exec(description);
    assert.ok(notClause, `${name} has no Not: clause`);
    for (const referenced of notClause[1].matchAll(/`([a-z][a-z-]+)`|\(([a-z][a-z-]+)\)/g)) {
      const target = referenced[1] ?? referenced[2];
      assert.ok(known.has(target), `${name} points at unknown skill "${target}"`);
    }
  }
});

test("no trigger phrase is claimed by two skills", () => {
  // A phrase listed in two descriptions makes routing a coin flip. This is the
  // check that would have caught "which Activity owns this page" living in both
  // trace-view-wiring and trace-ui-to-logic.
  const owners = new Map<string, string>();
  for (const [name, source] of Object.entries(skills)) {
    const description = scalarField(source, "description");
    for (const quoted of description.matchAll(/"([^"]{4,})"/g)) {
      const phrase = quoted[1].trim().toLowerCase();
      const existing = owners.get(phrase);
      assert.ok(
        existing === undefined || existing === name,
        `trigger phrase "${quoted[1]}" is claimed by both ${existing} and ${name}`,
      );
      owners.set(phrase, name);
    }
  }
});

test("every skill description carries at least one English trigger phrase", () => {
  for (const [name, source] of Object.entries(skills)) {
    const description = scalarField(source, "description");
    const english = [...description.matchAll(/"([^"]*)"/g)]
      .map((match) => match[1])
      .filter((phrase) => /[A-Za-z]{3}/.test(phrase) && !/[\u4e00-\u9fff]/.test(phrase));
    assert.ok(english.length > 0, `${name} needs at least one quoted English trigger phrase`);
  }
});

test("every skill carries the Android project gate", () => {
  for (const [name, source] of Object.entries(skills)) {
    assertContains(source, ["Android project gate", "HARD STOP", "does not make the repository Android"], name);
    assertContains(scalarField(source, "description"), ["Android-only"], `${name} description`);
  }
});

test("every skill opens with a Scope table routing its neighbours", () => {
  for (const [name, source] of Object.entries(skills)) {
    assert.match(source, /^## Scope$/m, `${name} needs a "## Scope" section`);
    const scope = /## Scope([\s\S]*?)(?=\n## )/.exec(source);
    assert.ok(scope, `${name} has no Scope body`);
    assert.match(scope[1], /\|.*\|/, `${name} Scope must be a table`);
  }
});

test("skills stay self-contained so sync-agent-skills can ship each one alone", () => {
  // A skill is copied into other agents on its own; a relative path that
  // escapes the skill directory would not resolve there.
  for (const [name, source] of Object.entries(skills)) {
    const relative = [...source.matchAll(/`(\.\.[^`]*)`/g)].map((match) => match[1]);
    for (const path of relative) {
      assert.ok(
        !path.includes("skills/"),
        `${name} reaches into another skill via "${path}"; copy the reference instead`,
      );
    }
  }
});

test("commands delegate to a skill and carry no gate body of their own", () => {
  const allowedSkill = /`(capture-ui|inspect-view-attribute|trace-view-wiring|trace-ui-to-logic|audit-ui)`/;
  for (const name of COMMAND_NAMES) {
    const source = read(`commands/${name}.md`);
    assert.match(source, allowedSkill, `commands/${name}.md must name its skill`);

    // The gate lives in the skill; a command repeats it only as one pointer line.
    assert.ok(
      !/^\*\*HARD STOP:\*\*/m.test(source),
      `commands/${name}.md must not inline the HARD STOP body`,
    );
    const gateLines = source.split(/\r?\n/).filter((line) => /^Gate:/i.test(line.trim()));
    assert.ok(
      gateLines.length <= 1,
      `commands/${name}.md should carry at most one gate pointer line, found ${gateLines.length}`,
    );
    assert.ok(
      source.length < 1500,
      `commands/${name}.md is ${source.length} characters; a command is an entry point, not a procedure`,
    );
  }
});

test("each command binds $ARGUMENTS and names its skill", () => {
  const expected: Record<(typeof COMMAND_NAMES)[number], string> = {
    capture: "capture-ui",
    "inspect-view": "inspect-view-attribute",
    "trace-view": "trace-view-wiring",
    "trace-logic": "trace-ui-to-logic",
    ui2logic: "trace-ui-to-logic",
    audit: "audit-ui",
  };
  for (const [command, skill] of Object.entries(expected)) {
    const source = read(`commands/${command}.md`);
    assert.ok(source.includes("$ARGUMENTS"), `commands/${command}.md must reference $ARGUMENTS`);
    assert.ok(source.includes(skill), `commands/${command}.md must point at ${skill}`);
  }
});

test("capture-ui reports the big-dimension facts and the artifact caveat", () => {
  const source = skills["capture-ui"];
  assertContains(source, ["activity", "uiKind", "savePath", "uiautomator"], "capture-ui");
  assert.match(
    source,
    /Layout Inspector cannot open/i,
    "capture-ui must state that Android Studio cannot open our dump",
  );
});

test("inspect-view-attribute owns raw property names and the px/dp caveat", () => {
  const source = skills["inspect-view-attribute"];
  assertContains(
    source,
    ["includeProperties", "layoutParams", "padding:", "measurement:", "density"],
    "inspect-view-attribute",
  );
  assert.match(source, /MATCH_PARENT/, "inspect-view-attribute must decode -1 as MATCH_PARENT");
});

test("trace-view-wiring covers the four questions", () => {
  const source = skills["trace-view-wiring"];
  assertContains(source, ["Implementation", "Events", "Visibility", "Content"], "trace-view-wiring");
  assertContains(source, ["stringResource", "setOnClickListener", "setText"], "trace-view-wiring");
});

test("trace-ui-to-logic is scoped to a block, not the whole screen", () => {
  const source = skills["trace-ui-to-logic"];
  assert.match(source, /## Scope/);
  assert.match(source, /block/i, "trace-ui-to-logic must talk about a block/section");
  assert.ok(
    !/whole current screen/i.test(source.split("## Step 1")[0]),
    "trace-ui-to-logic must not claim the whole screen as its default scope",
  );
});

test("audit-ui lists the rules it reports, including overdraw and RTL", () => {
  const source = skills["audit-ui"];
  assertContains(
    source,
    ["small_touch_target", "overlap", "clipped", "deep_nesting", "overdraw", "rtl_issues"],
    "audit-ui",
  );
});

test("the ordering axis is documented: single control vs section vs screen", () => {
  // Each skill's Scope table must name at least one neighbour, so a reader can
  // resolve an ambiguous request without reading five files.
  for (const [name, source] of Object.entries(skills)) {
    const scope = /## Scope([\s\S]*?)(?=\n## )/.exec(source);
    assert.ok(scope, `${name} has no Scope section`);
    const neighbours = [...scope[1].matchAll(/`([a-z][a-z-]+)`/g)]
      .map((match) => match[1])
      .filter((target) => target !== name && SKILL_NAMES.includes(target as never));
    assert.ok(neighbours.length > 0, `${name} Scope must route at least one neighbouring skill`);
  }
});