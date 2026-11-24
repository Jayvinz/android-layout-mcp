/**
 * MCP client config generation.
 *
 * The server speaks MCP over stdio, so every client can run it; only the config
 * envelope differs. Each entry below records the file a human should merge the
 * snippet into and the shape that client expects.
 */
export declare const MCP_CLIENT_IDS: readonly ["claude", "claude-desktop", "codebuddy", "workbuddy", "cursor", "windsurf", "devin", "cline", "kiro", "gemini", "antigravity", "qwen", "trae", "vscode", "codex", "zed", "opencode", "goose", "amp", "generic"];
export type McpClientId = (typeof MCP_CLIENT_IDS)[number];
export interface McpClientConfig {
    client: McpClientId;
    /** Human hint for where to paste the snippet. */
    target: string;
    format: "json" | "toml" | "yaml";
    content: string;
}
export declare function isMcpClient(value: string): value is McpClientId;
/**
 * Build the config snippet for one client.
 *
 * `command` is the executable (`node`) and `args` the server entry plus any
 * device/Compose flags, so `--serial`/`--adb`/`--studio` carry over unchanged.
 */
export declare function mcpClientConfig(client: McpClientId, command: string, args: string[]): McpClientConfig;
