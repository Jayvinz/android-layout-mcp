/**
 * MCP client config generation.
 *
 * The server speaks MCP over stdio, so every client can run it; only the config
 * envelope differs. Each entry below records the file a human should merge the
 * snippet into and the shape that client expects.
 */

export const MCP_CLIENT_IDS = [
  "claude",
  "claude-desktop",
  "cursor",
  "windsurf",
  "devin",
  "cline",
  "kiro",
  "gemini",
  "antigravity",
  "qwen",
  "trae",
  "vscode",
  "codex",
  "zed",
  "opencode",
  "goose",
  "amp",
  "generic",
] as const;

export type McpClientId = (typeof MCP_CLIENT_IDS)[number];

type Family = "mcpServers" | "amp" | "vscode" | "zed" | "opencode" | "codex" | "goose";

interface ClientTarget {
  family: Family;
  /** Where the snippet belongs. `~` is the home directory on every platform. */
  target: string;
}

const CLIENTS: Record<McpClientId, ClientTarget> = {
  claude: { family: "mcpServers", target: ".mcp.json (project root) or claude mcp add" },
  "claude-desktop": { family: "mcpServers", target: "claude_desktop_config.json" },
  cursor: { family: "mcpServers", target: ".cursor/mcp.json or ~/.cursor/mcp.json" },
  windsurf: { family: "mcpServers", target: "~/.codeium/windsurf/mcp_config.json" },
  devin: { family: "mcpServers", target: ".devin/mcp_config.json or ~/.config/devin/mcp_config.json" },
  cline: { family: "mcpServers", target: "cline_mcp_settings.json (Cline MCP panel)" },
  kiro: { family: "mcpServers", target: ".kiro/settings/mcp.json or ~/.kiro/settings/mcp.json" },
  gemini: { family: "mcpServers", target: ".gemini/settings.json or ~/.gemini/settings.json" },
  antigravity: { family: "mcpServers", target: "~/.gemini/config/mcp_config.json" },
  qwen: { family: "mcpServers", target: ".qwen/settings.json or ~/.qwen/settings.json" },
  trae: { family: "mcpServers", target: ".trae/mcp.json" },
  vscode: { family: "vscode", target: ".vscode/mcp.json (VS Code + Copilot)" },
  codex: { family: "codex", target: "~/.codex/config.toml or .codex/config.toml" },
  zed: { family: "zed", target: "settings.json (Zed context servers)" },
  opencode: { family: "opencode", target: "opencode.json or ~/.config/opencode/opencode.json" },
  goose: { family: "goose", target: "~/.config/goose/config.yaml" },
  amp: { family: "amp", target: "~/.config/amp/settings.json or .amp/settings.json" },
  generic: { family: "mcpServers", target: "any client that reads a mcpServers object" },
};

export interface McpClientConfig {
  client: McpClientId;
  /** Human hint for where to paste the snippet. */
  target: string;
  format: "json" | "toml" | "yaml";
  content: string;
}

const SERVER_NAME = "android-ui";

export function isMcpClient(value: string): value is McpClientId {
  return (MCP_CLIENT_IDS as readonly string[]).includes(value);
}

/**
 * Build the config snippet for one client.
 *
 * `command` is the executable (`node`) and `args` the server entry plus any
 * device/Compose flags, so `--serial`/`--adb`/`--studio` carry over unchanged.
 */
export function mcpClientConfig(client: McpClientId, command: string, args: string[]): McpClientConfig {
  const { family, target } = CLIENTS[client];

  switch (family) {
    case "mcpServers":
      return {
        client,
        target,
        format: "json",
        content: json({ mcpServers: { [SERVER_NAME]: { command, args } } }),
      };
    case "amp":
      return {
        client,
        target,
        format: "json",
        content: json({ "amp.mcpServers": { [SERVER_NAME]: { command, args } } }),
      };
    case "vscode":
      return {
        client,
        target,
        format: "json",
        content: json({ servers: { [SERVER_NAME]: { type: "stdio", command, args } } }),
      };
    case "zed":
      return {
        client,
        target,
        format: "json",
        content: json({ context_servers: { [SERVER_NAME]: { command: { path: command, args } } } }),
      };
    case "opencode":
      return {
        client,
        target,
        format: "json",
        content: json({ mcp: { [SERVER_NAME]: { type: "local", command: [command, ...args], enabled: true } } }),
      };
    case "codex": {
      const list = args.map((arg) => `  ${tomlString(arg)},`).join("\n");
      return {
        client,
        target,
        format: "toml",
        content: `[mcp_servers.${SERVER_NAME}]\ncommand = ${tomlString(command)}\nargs = [\n${list}\n]\n`,
      };
    }
    case "goose": {
      const list = args.map((arg) => `      - ${yamlString(arg)}`).join("\n");
      return {
        client,
        target,
        format: "yaml",
        content: `extensions:\n  ${SERVER_NAME}:\n    command: ${yamlString(command)}\n    args:\n${list}\n    enabled: true\n`,
      };
    }
  }
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** JSON string escapes are valid TOML basic strings, including Windows paths. */
function tomlString(value: string): string {
  return JSON.stringify(value);
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}
