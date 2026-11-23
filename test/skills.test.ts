import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
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
    assert.ok(haystack.includes(needle), `${label} description is missing "${needle}"`);
  }
}

const components = {
  inspect: read("skills/inspect-current-screen/SKILL.md"),
  locate: read("skills/locate-ui-code/SKILL.md"),
  verify: read("skills/verify-ui-change/SKILL.md"),
  agent: read("agents/ui-code-locator.md"),
};

test("component descriptions are valid and within the 1024-character limit", () => {
  for (const [name, source] of Object.entries(components)) {
    const description = scalarField(source, "description");
    assert.ok(description.length > 0, `${name} description is empty`);
    assert.ok(
      description.length <= 1024,
      `${name} description is ${description.length} characters (max 1024)`,
    );
  }
});

test("inspect-current-screen description owns screen and control observation", () => {
  assertContains(
    scalarField(components.inspect, "description"),
    [
      "抓取当前页面布局",
      "当前页面布局",
      "summarize the current screen",
      "看下当前",
      "这个控件多大",
      "有没有小点击区域",
      "打开可视化看看",
      "在浏览器里打开当前页面",
      "可视化当前布局",
      "open the UI viewer",
      "locate-ui-code",
      "verify-ui-change",
    ],
    "inspect-current-screen",
  );
});

test("locate-ui-code description owns source tracing and excludes screen observation", () => {
  assertContains(
    scalarField(components.locate, "description"),
    [
      "这个按钮在哪实现的",
      "按 UI 找已有业务逻辑",
      "这个点击事件/可见性/状态在哪个 ViewModel/Repository",
      "inspect-current-screen",
      "Not for general Android questions",
    ],
    "locate-ui-code",
  );
});

test("verify-ui-change description owns before/after verification", () => {
  assertContains(
    scalarField(components.verify, "description"),
    ["改完了看看生效没", "这次改动有没有回归", "inspect-current-screen"],
    "verify-ui-change",
  );
});

test("screen command delegates to the inspect-current-screen skill", () => {
  const command = read("commands/screen.md");
  assert.ok(command.includes("inspect-current-screen"), "screen.md must reference inspect-current-screen");
  assert.ok(
    /Do not scan the repository or call `locate_code`/i.test(command),
    "screen.md must tell the model not to scan source by default",
  );
});

test("view command delegates to the viewer tool", () => {
  const command = read("commands/view.md");
  assert.ok(command.includes("inspect-current-screen"), "view.md must reference inspect-current-screen");
  assert.ok(command.includes("open_viewer"), "view.md must call open_viewer");
  assert.ok(
    /static snapshot|do not modify code|living refresh/i.test(command),
    "view.md must describe the snapshot semantics",
  );
});

test("MCP tool descriptions carry the screen-observation routing phrases", () => {
  const mcp = read("src/mcp.ts");
  const blocks = mcp.split("server.registerTool(");
  const blockFor = (tool: string): string => {
    const block = blocks.find((candidate) => candidate.trimStart().startsWith(`"${tool}"`));
    assert.ok(block, `expected a registerTool block for ${tool}`);
    return block;
  };

  assertContains(blockFor("dump_ui"), ["抓取当前页面布局", "导出布局树", "当前界面有什么"], "dump_ui");
  assertContains(blockFor("find_elements"), ["看下当前", "这个控件多大"], "find_elements");
  assertContains(blockFor("analyze_ui"), ["有没有小点击区域", "无障碍检查"], "analyze_ui");
  assertContains(blockFor("screenshot"), ["截个图看看", "看一下画面"], "screenshot");
  assertContains(blockFor("hit_test"), ["屏幕坐标 300,800"], "hit_test");
  assertContains(
    blockFor("open_viewer"),
    ["打开可视化看看", "在浏览器里打开当前页面", "可视化当前布局", "open the UI viewer", "never call it"],
    "open_viewer",
  );
  assertContains(blockFor("locate_code"), ["not for general Android concept questions"], "locate_code");
});
