import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const hook = fileURLToPath(new URL("../hooks/alm-android-gate.mjs", import.meta.url));

function makeWorkspace(android: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "alm-gate-"));
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
    assert.equal(decide(project, "看下这个按钮在哪", "find_elements"), "deny");
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
        "android-layout: MCP server android-layout is ready. Commands: /android-layout:capture, /android-layout:trace-view.",
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
    assert.equal(decide(project, "看下当前设备页面", "find_elements"), "allow");
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
    assert.equal(decide(project, "分析当前界面的代码", "find_elements"), "allow");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

// The plugin ships nine device-touching tools; every one of them is gated.
const DEVICE_TOOLS = [
  "list_devices",
  "get_state",
  "dump_ui",
  "find_elements",
  "locate_code",
  "hit_test",
  "analyze_ui",
  "list_fragments",
  "screenshot",
];

// The five tools added to the gate after the first four.
const NEWLY_GATED_TOOLS = ["list_devices", "hit_test", "analyze_ui", "list_fragments", "screenshot"];

test("denies all nine device tools in a non-Android workspace without an explicit cue", () => {
  const project = makeWorkspace(false);
  try {
    for (const tool of DEVICE_TOOLS) {
      assert.equal(decide(project, "分析当前界面的代码", tool), "deny", tool);
    }
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("allows every newly gated tool on an explicit device request in a non-Android workspace", () => {
  const project = makeWorkspace(false);
  try {
    for (const tool of NEWLY_GATED_TOOLS) {
      // Device cue in Chinese.
      assert.equal(decide(project, "看下当前设备页面", tool), "allow", tool);
      // Device cue in English.
      assert.equal(decide(project, "What is on the emulator screen right now?", tool), "allow", tool);
    }
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("allows every newly gated tool when the user explicitly mentions Android", () => {
  const project = makeWorkspace(false);
  try {
    for (const tool of NEWLY_GATED_TOOLS) {
      assert.equal(decide(project, "In an Android repo, inspect the current page", tool), "allow", tool);
    }
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("allows every newly gated tool in an Android project", () => {
  const project = makeWorkspace(true);
  try {
    for (const tool of NEWLY_GATED_TOOLS) {
      assert.equal(decide(project, "分析当前界面的代码", tool), "allow", tool);
    }
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("still honours the stricter locate_code rule for the whole nine-tool set", () => {
  const project = makeWorkspace(false);
  try {
    // A device cue alone never justifies source scanning.
    assert.equal(decide(project, "看下当前设备页面", "locate_code"), "deny");
    assert.equal(decide(project, "Take a screenshot of the device screen", "locate_code"), "deny");
    // Observation tools keep working on the same device cue.
    assert.equal(decide(project, "Look at the device screen", "screenshot"), "allow");
    // An explicit Android mention unlocks source scanning.
    assert.equal(decide(project, "分析这个 Android 弹窗的代码", "locate_code"), "allow");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("ignores injected context for the newly gated tools too", () => {
  const project = makeWorkspace(false);
  try {
    for (const tool of NEWLY_GATED_TOOLS) {
      assert.equal(
        decide(project, "分析当前界面的代码", tool, "# Capture UI\nAndroid projects only... device screen"),
        "deny",
        tool,
      );
    }
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("leaves non-device tools alone outside the gate", () => {
  const project = makeWorkspace(false);
  try {
    // The gate must not over-match a tool that is not in the nine-tool set.
    assert.equal(decide(project, "分析当前界面的代码", "list_windows"), "allow");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
test("a bare locate_code tool name still gets the stricter rule", () => {
  const project = makeWorkspace(false);
  try {
    const transcript = join(project, "transcript.jsonl");
    writeFileSync(
      transcript,
      `${JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "text", text: "看下当前设备页面" }] },
      })}\n`,
    );
    const bare = (tool: string) => {
      const result = spawnSync(process.execPath, [hook], {
        input: JSON.stringify({ tool_name: tool, cwd: project, transcript_path: transcript }),
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout).hookSpecificOutput.permissionDecision;
    };
    // A device cue alone never justifies source scanning, prefixed or not.
    assert.equal(bare("mcp__plugin_android-layout_android-layout__locate_code"), "deny");
    assert.equal(bare("locate_code"), "deny");
    // Observation tools stay allowed on the same cue.
    assert.equal(bare("hit_test"), "allow");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
