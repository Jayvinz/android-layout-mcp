#!/usr/bin/env node
/**
 * PreToolUse gate for the android-layout MCP tools.
 *
 * The plugin's activation paths target Android projects. This hook is a hard
 * backstop for the skill prose: it covers all nine device-touching tools
 * (list_devices, get_state, dump_ui, find_elements, locate_code, hit_test,
 * analyze_ui, list_fragments, screenshot). When the workspace is not an Android
 * project they are denied unless the user's latest message explicitly asks
 * about a connected device screen/page or mentions Android; locate_code
 * additionally requires an explicit Android mention.
 *
 * Fail-open on internal errors so a broken hook never blocks legitimate work.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const GATED_TOOLS =
  /(?:^|__)(list_devices|get_state|dump_ui|find_elements|locate_code|hit_test|analyze_ui|list_fragments|screenshot)$/;

function debug(value) {
  if (process.env.AUI_GATE_DEBUG !== "1") return;
  try {
    appendFileSync(join(tmpdir(), "aui-android-gate.log"), `${JSON.stringify(value)}\n`);
  } catch {
    // Debug logging must never affect the decision.
  }
}

function allow() {
  debug({ decision: "allow" });
  write({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
  });
}

function deny(reason) {
  debug({ decision: "deny", reason });
  write({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
    systemMessage: reason,
  });
}

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function hasAndroidMarkers(startDir) {
  let dir = resolve(startDir || process.cwd());
  for (let depth = 0; depth < 10; depth += 1) {
    if (
      existsSync(join(dir, "settings.gradle")) ||
      existsSync(join(dir, "settings.gradle.kts")) ||
      existsSync(join(dir, "gradlew")) ||
      existsSync(join(dir, "gradlew.bat")) ||
      existsSync(join(dir, "AndroidManifest.xml")) ||
      existsSync(join(dir, "app", "src", "main", "AndroidManifest.xml"))
    ) {
      return true;
    }
    for (const gradle of ["build.gradle", "build.gradle.kts"]) {
      const file = join(dir, gradle);
      if (!existsSync(file)) continue;
      try {
        if (/com\.android\.(application|library|compose)/.test(readFileSync(file, "utf8"))) {
          return true;
        }
      } catch {
        // Ignore unreadable files and continue walking up.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

function cleanPrompt(text) {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "")
    .replace(/<local-command[^>]*>[\s\S]*?<\/local-command[^>]*>/gi, "")
    .trim();
}

function isGenuinePrompt(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith("# ")) return false;
  if (trimmed.startsWith("Launching skill:")) return false;
  // Plugin context, skill bodies, and other injected text are long and/or
  // mention the plugin itself; the user's prompt does not.
  if (trimmed.length > 500) return false;
  if (/mcp__plugin|\/android-layout:/i.test(trimmed)) return false;
  return true;
}

function readLastUserText(transcriptPath) {
  if (!transcriptPath) return "";
  try {
    const lines = readFileSync(transcriptPath, "utf8").trim().split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      let entry;
      try {
        entry = JSON.parse(lines[index]);
      } catch {
        continue;
      }
      if (entry.type !== "user") continue;
      const content = entry.message?.content ?? entry.content;
      if (typeof content === "string") {
        const cleaned = cleanPrompt(content);
        if (isGenuinePrompt(cleaned)) return cleaned;
        continue;
      }
      if (Array.isArray(content)) {
        const texts = content
          .filter((part) => part && part.type === "text" && typeof part.text === "string")
          .map((part) => cleanPrompt(part.text));
        const joined = texts.filter(Boolean).join("\n");
        if (isGenuinePrompt(joined)) return joined;
      }
    }
  } catch {
    // Fall through to the empty prompt.
  }
  return "";
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    allow();
    return;
  }

  const toolName = String(input.tool_name ?? "");
  if (!GATED_TOOLS.test(toolName)) {
    allow();
    return;
  }

  const cwd = String(input.cwd ?? input.tool_input?.cwd ?? process.cwd());
  const androidProject = hasAndroidMarkers(cwd);
  debug({ toolName, cwd, androidProject });
  if (androidProject) {
    allow();
    return;
  }

  const prompt = readLastUserText(input.transcript_path);
  debug({ prompt: prompt.slice(0, 160) });
  if (!prompt) {
    // If the transcript is unreadable (some headless integrations do not record
    // the initial prompt), fail open rather than blocking a legitimate device
    // request. The skill/command hard-stop prose still applies.
    allow();
    return;
  }
  const explicitAndroid = /(android|安卓)/i.test(prompt);
  const explicitDevice = /(设备|真机|手机|device|emulator)/i.test(prompt);
  const explicitDeviceOrAndroid = explicitAndroid || explicitDevice;
  const isSourceTool = /(?:^|__)locate_code$/.test(toolName);
  debug({ prompt: prompt.slice(0, 160), explicitAndroid, explicitDevice, isSourceTool });

  if (!explicitDeviceOrAndroid) {
    deny(
      "This workspace is not an Android project. Do not call any device tool " +
        "(list_devices, get_state, dump_ui, find_elements, hit_test, analyze_ui, " +
        "list_fragments, screenshot, locate_code) unless the user explicitly asks " +
        'about the device screen/page or mentions Android. Reply in one sentence that ' +
        "this plugin targets Android projects, then offer to inspect the device if they " +
        "ask, or ask for the Android module path.",
    );
    return;
  }

  if (isSourceTool && !explicitAndroid) {
    deny(
      "This workspace is not an Android project, so source scanning is unavailable. " +
        "Do not call locate_code. Reply that source tracing needs the Android module path; " +
        "device observation may continue only if the user explicitly asked for it.",
    );
    return;
  }

  allow();
}

try {
  main();
} catch {
  allow();
}