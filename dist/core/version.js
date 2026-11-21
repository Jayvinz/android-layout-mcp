import { readFileSync } from "node:fs";
/**
 * package.json is the only version source. Claude Code still needs a literal
 * version in .claude-plugin/plugin.json, which scripts/sync-version.mjs keeps in
 * sync; the CLI/MCP read package.json directly so they cannot drift.
 */
export const PACKAGE_VERSION = (() => {
    try {
        const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
        return typeof pkg.version === "string" && pkg.version.length > 0 ? pkg.version : "0.0.0";
    }
    catch {
        return "0.0.0";
    }
})();
