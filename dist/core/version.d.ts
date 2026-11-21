/**
 * package.json is the only version source. Claude Code still needs a literal
 * version in .claude-plugin/plugin.json, which scripts/sync-version.mjs keeps in
 * sync; the CLI/MCP read package.json directly so they cannot drift.
 */
export declare const PACKAGE_VERSION: string;
