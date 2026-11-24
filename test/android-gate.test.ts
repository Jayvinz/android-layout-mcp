import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const hook = fileURLToPath(new URL("../hooks/aui-android-gate.mjs", import.meta.url));

function makeWorkspace(android: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "aui-gate-"));
  const project = join(root, "project");
  mkdirSync(project);
  if (android) writeFileSync(join(project, "settings.gradle.kts"), "");
  return project;
}

function decide(project: string, prompt: string, tool: string, injected?: string): string {
  const transcript = join(project, "transcript.jsonl");
  const lines = [
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: prompt }] },
    }),
  ];
  if (injected) {
    lines.push(
      JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "text", text: injected }] },
      }),
    );
  }
  writeFileSync(transcript, `${lines.join("\n")}\n`);
  const result = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({
      tool_name: `mcp__plugin_android-layout_android-layout__${tool}`,
      cwd: project,
      transcript_path: transcript,
    }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).hookSpecificOutput.permissionDecision;
}

test("denies device tools in a non-Android workspace without an explicit cue", () => {
  const project = makeWorkspace(false);
  try {
    assert.equal(decide(project, "分析当前界面的代码", "get_state"), "deny");
    assert.equal(decide(project, "分析当前界面的代码", "dump_ui"), "deny");
    assert.equal(decide(project, "这个按钮在哪实现的", "locate_code"), "deny");
    assert.equal(decide(project, "打开可视化看看当前页面", "open_viewer"), "deny");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("ignores injected skill bodies when reading the user intent", () => {
  const project = makeWorkspace(false);
  try {
    assert.equal(
      decide(project, "分析当前界面的代码", "get_state", "# UI → Code Location\nAndroid projects only..."),
      "deny",
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("ignores Android mentions inside system reminders", () => {
  const project = makeWorkspace(false);
  try {
    assert.equal(
      decide(
        project,
        "分析当前界面的代码\n<system-reminder>The Android plugin is installed.</system-reminder>",
        "get_state",
      ),
      "deny",
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("ignores plugin-name context in later user turns", () => {
  const project = makeWorkspace(false);
  try {
    assert.equal(
      decide(
        project,
        "分析当前界面的代码",
        "get_state",
        "android-layout: MCP server android-layout is ready. Commands: /android-layout:screen, /android-layout:locate.",
      ),
      "deny",
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("fails open when the transcript has no readable user prompt", () => {
  const project = makeWorkspace(false);
  try {
    assert.equal(decide(project, "", "get_state"), "allow");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("allows observation on an explicit device request in a non-Android workspace", () => {
  const project = makeWorkspace(false);
  try {
    assert.equal(decide(project, "看下当前设备页面", "get_state"), "allow");
    assert.equal(decide(project, "看下当前设备页面", "dump_ui"), "allow");
    assert.equal(decide(project, "在设备上打开可视化看看", "open_viewer"), "allow");
    // A device cue alone does not justify source scanning.
    assert.equal(decide(project, "看下当前设备页面", "locate_code"), "deny");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("allows an explicit Android mention in a non-Android workspace", () => {
  const project = makeWorkspace(false);
  try {
    assert.equal(decide(project, "分析这个 Android 弹窗的代码", "locate_code"), "allow");
    assert.equal(decide(project, "In an Android project, dump the screen", "dump_ui"), "allow");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("allows gated tools in an Android project and leaves other tools alone", () => {
  const project = makeWorkspace(true);
  try {
    assert.equal(decide(project, "分析当前界面的代码", "get_state"), "allow");
    assert.equal(decide(project, "分析当前界面的代码", "locate_code"), "allow");
    assert.equal(decide(project, "打开可视化看看", "open_viewer"), "allow");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});