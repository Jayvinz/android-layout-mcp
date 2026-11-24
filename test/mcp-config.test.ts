import { test } from "node:test";
import { strict as assert } from "node:assert";
import { MCP_CLIENT_IDS, isMcpClient, mcpClientConfig } from "../src/core/mcp-config.js";

const SERVER = "C:\\tools\\android-ui-inspector\\dist\\mcp.js";
const ARGS = [SERVER, "--serial", "emulator-5554"];

test("every client produces a non-empty snippet with a destination", () => {
  for (const client of MCP_CLIENT_IDS) {
    const config = mcpClientConfig(client, "node", ARGS);
    assert.equal(config.client, client);
    assert.ok(config.target.length > 0, `${client} needs a target file hint`);
    assert.ok(config.content.trim().length > 0, `${client} snippet is empty`);
    assert.ok(config.content.endsWith("\n"), `${client} snippet should end with a newline`);
  }
});

test("mcpServers clients keep the portable object shape", () => {
  for (const client of ["claude", "claude-desktop", "codebuddy", "workbuddy", "cursor", "gemini", "cline", "generic"] as const) {
    const config = mcpClientConfig(client, "node", ARGS);
    assert.equal(config.format, "json");
    const parsed = JSON.parse(config.content) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    assert.deepEqual(parsed.mcpServers["android-ui"], { command: "node", args: ARGS });
  }
});

test("vscode uses a servers root key and an explicit stdio type", () => {
  const parsed = JSON.parse(mcpClientConfig("vscode", "node", ARGS).content) as {
    servers: Record<string, { type: string; command: string; args: string[] }>;
  };
  assert.deepEqual(parsed.servers["android-ui"], { type: "stdio", command: "node", args: ARGS });
});

test("zed nests the command under context_servers", () => {
  const parsed = JSON.parse(mcpClientConfig("zed", "node", ARGS).content) as {
    context_servers: Record<string, { command: { path: string; args: string[] } }>;
  };
  assert.deepEqual(parsed.context_servers["android-ui"].command, { path: "node", args: ARGS });
});

test("opencode uses a local command array", () => {
  const parsed = JSON.parse(mcpClientConfig("opencode", "node", ARGS).content) as {
    mcp: Record<string, { type: string; command: string[]; enabled: boolean }>;
  };
  assert.deepEqual(parsed.mcp["android-ui"], {
    type: "local",
    command: ["node", ...ARGS],
    enabled: true,
  });
});

test("amp keeps the dotted amp.mcpServers key", () => {
  const parsed = JSON.parse(mcpClientConfig("amp", "node", ARGS).content) as {
    "amp.mcpServers": Record<string, { command: string; args: string[] }>;
  };
  assert.deepEqual(parsed["amp.mcpServers"]["android-ui"], { command: "node", args: ARGS });
});

test("codex emits TOML with escaped Windows paths", () => {
  const config = mcpClientConfig("codex", "node", ARGS);
  assert.equal(config.format, "toml");
  assert.ok(config.content.startsWith("[mcp_servers.android-ui]\n"));
  assert.ok(config.content.includes('command = "node"'));
  // A raw backslash would break the TOML string; JSON escaping produces \\.
  assert.ok(config.content.includes(SERVER.replaceAll("\\", "\\\\")));
  assert.ok(config.content.includes("--serial"));
});

test("goose emits YAML extensions with an enabled flag", () => {
  const config = mcpClientConfig("goose", "node", ARGS);
  assert.equal(config.format, "yaml");
  const lines = config.content.split("\n");
  assert.equal(lines[0], "extensions:");
  assert.equal(lines[1], "  android-ui:");
  assert.ok(lines.includes('    command: "node"'));
  assert.ok(lines.includes("    enabled: true"));
  assert.ok(lines.some((line) => line.startsWith("      - ")));
});

test("unknown client ids are rejected", () => {
  assert.equal(isMcpClient("codex"), true);
  assert.equal(isMcpClient("nope"), false);
});
