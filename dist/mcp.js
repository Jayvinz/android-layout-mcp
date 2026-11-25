import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Adb } from "./core/adb.js";
import { analyzeCapture, issuesToJson } from "./core/analyze.js";
import { capture, treesFor } from "./core/capture.js";
import { allFragments, notableFragments, parseDumpsys } from "./core/dumpsys.js";
import { AuiError, errorMessage } from "./core/errors.js";
import { JdwpClient } from "./core/jdwp.js";
import { findNodes, hitTest, nodePath, nodeSummary } from "./core/query.js";
import { renderCapture, renderSource } from "./core/render.js";
import { renderAnnotatedSvg, saveScreenshot, screenshotMetadata, takeScreenshot, } from "./core/screenshot.js";
import { serializeNode } from "./core/viewdump.js";
import { saveDump } from "./core/serialize.js";
import { PACKAGE_VERSION } from "./core/version.js";
const TOOL_SERVER_INFO = {
    name: "android-layout",
    version: PACKAGE_VERSION,
};
const execFileAsync = promisify(execFile);
const LOCATOR_SCRIPT = fileURLToPath(new URL("../scripts/locate-code.mjs", import.meta.url));
const sourceSchema = z.enum(["auto", "view", "semantics", "dumpsys", "compose", "both"]);
const ruleSchema = z.enum([
    "zero_size",
    "offscreen",
    "small_touch_target",
    "invisible_clickable",
    "unlabeled_clickable",
    "duplicate_id",
    "deep_nesting",
    "overlap",
    "clipped",
    "outside_parent",
]);
export async function startMcpServer(options = {}) {
    const server = new McpServer(TOOL_SERVER_INFO);
    const adbFor = (serial) => new Adb({
        adbPath: options.adb,
        serial: serial ?? options.serial,
        timeoutMs: options.timeout ?? 30_000,
    });
    let lastSerial;
    let screenshotFallbackEnabled = false;
    const captureFor = async (args) => {
        lastSerial = args.serial;
        screenshotFallbackEnabled = true;
        const adb = adbFor(args.serial);
        const captureOptions = {
            adb,
            source: args.source ?? "auto",
            packageName: args.package,
            pid: args.pid,
            window: args.window,
            includeProperties: args.includeProperties,
            requestTimeoutMs: options.timeout ?? 30_000,
            studioPath: options.studioPath,
            javaPath: options.javaPath,
            composeVersion: options.composeVersion,
        };
        return capture(captureOptions);
    };
    async function errorResultWithScreenshot(error) {
        if (!screenshotFallbackEnabled ||
            process.env.AUI_NO_FALLBACK_SCREENSHOT === "1" ||
            (error instanceof AuiError && error.code === "BAD_INPUT")) {
            return errorResult(error);
        }
        try {
            const adb = adbFor(lastSerial);
            const shot = await takeScreenshot(adb, { maxWidth: 720 });
            return {
                isError: true,
                content: [
                    { type: "image", data: shot.buffer.toString("base64"), mimeType: "image/png" },
                    {
                        type: "text",
                        text: `Error: ${errorMessage(error)}
  ` +
                            `Fallback screenshot attached (${shot.width}x${shot.height} from ${shot.originalWidth}x${shot.originalHeight}).`,
                    },
                ],
            };
        }
        catch {
            return errorResult(error);
        }
    }
    server.registerTool("list_devices", {
        title: "List Android devices",
        description: "List connected Android devices with model, Android version, and SDK level. Use the serial in other tools when multiple devices are connected.",
        inputSchema: {},
        annotations: { readOnlyHint: true, openWorldHint: true },
    }, async () => {
        try {
            const devices = await adbFor().devices();
            return jsonResult({ devices });
        }
        catch (error) {
            return errorResultWithScreenshot(error);
        }
    });
    server.registerTool("get_state", {
        title: "Get device and app state",
        description: "Returns the connected device, screen size/density/orientation, foreground package and activity, process ids, and the app's ViewRootImpl windows (if debuggable). Call this before UI inspection to learn what is on screen. Android repos only; non-Android: call only on an explicit device/screen request or Android mention.",
        inputSchema: {
            serial: z.string().optional().describe("Device serial; omit when only one device is connected."),
            package: z.string().optional().describe("Package to inspect; defaults to the foreground app."),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
    }, async ({ serial, package: packageName }) => {
        try {
            const adb = adbFor(serial);
            const device = await adb.resolveDevice();
            const [screen, foreground] = await Promise.all([adb.screenInfo(), adb.foregroundApp()]);
            const effectivePackage = packageName || foreground.packageName;
            const pids = effectivePackage ? await adb.packagePids(effectivePackage) : [];
            let windows = [];
            if (pids[0]) {
                try {
                    const client = await JdwpClient.open(adb, pids[0], { requestTimeoutMs: 8000 });
                    try {
                        windows = await client.listWindows();
                    }
                    finally {
                        await client.close();
                    }
                }
                catch (error) {
                    windows = { error: errorMessage(error) };
                }
            }
            return jsonResult({ device, screen, foreground, package: effectivePackage, pids, windows });
        }
        catch (error) {
            return errorResultWithScreenshot(error);
        }
    });
    server.registerTool("dump_ui", {
        title: "Dump the UI hierarchy",
        description: "Capture the current UI. source=view uses the ViewDebug hierarchy over JDWP (full View classes, layout params, padding, visibility, margins; requires a debuggable app). source=semantics uses the accessibility tree via uiautomator (best zero-config option for Compose text/controls; works on any app). source=compose uses Android Studio's transport/JVMTI Compose inspector to return composable names, file/line, bounds, parameters/text and recomposition counts (requires a debuggable app, a local Android Studio install, and Compose 1.8.3 by default). auto selects semantics for Compose apps and view otherwise. Use format=tree for a compact human-readable tree or format=json (default) for structured data. Nodes include ref, bounds, visibleBounds, center, clickable and the full parent path is available in find_elements. Use this for requests such as \"抓取当前页面布局\", \"导出布局树\", \"当前界面有什么\", or \"dump the screen\": call get_state first, then dump_ui(source=\"auto\", format=\"tree\"). Android repos only; non-Android: call only on an explicit device/screen request or Android mention.",
        inputSchema: {
            serial: z.string().optional().describe("Device serial."),
            package: z.string().optional().describe("Package to inspect; defaults to foreground app."),
            source: sourceSchema.optional().describe("auto (default), view, semantics, dumpsys, compose, or both."),
            format: z.enum(["json", "tree"]).optional().describe("json (default) or tree."),
            depth: z.number().int().min(0).max(100).optional().describe("Limit JSON tree depth; omit for full depth."),
            maxNodes: z.number().int().min(1).max(5000).optional().describe("Limit JSON nodes (default 800)."),
            includeProperties: z.boolean().optional().describe("Include every ViewDebug property in JSON."),
            visibleOnly: z.boolean().optional().describe("For format=tree, hide invisible/gone views."),
            window: z.string().optional().describe("ViewRootImpl window name or index for source=view."),
            savePath: z.string().optional().describe("Write the full JSON dump to this file."),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
    }, async (args) => {
        try {
            const result = await captureFor({
                serial: args.serial,
                package: args.package,
                window: args.window,
                source: args.source,
                includeProperties: args.includeProperties,
            });
            if (args.savePath)
                await saveDump(result, args.savePath);
            if (args.format === "tree") {
                const text = renderCapture(result, renderSource(args.source), {
                    depth: args.depth,
                    maxNodes: args.maxNodes ?? 1500,
                    visibleOnly: args.visibleOnly,
                    showCenter: true,
                });
                return textResult(text + (args.savePath ? `\n\ndump saved to ${args.savePath}` : ""));
            }
            const maxNodes = args.maxNodes ?? 800;
            const tree = (roots) => {
                const treeCounter = { value: 0 };
                return roots.map((root) => serializeNode(root, {
                    depth: args.depth,
                    includeProps: args.includeProperties,
                    maxNodes,
                    counter: treeCounter,
                }));
            };
            const payload = {
                device: {
                    serial: result.device.serial,
                    model: result.device.model,
                    androidRelease: result.device.androidRelease,
                    sdk: result.device.sdk,
                },
                target: {
                    packageName: result.target.packageName,
                    pid: result.target.pid,
                    activity: result.target.activity,
                    debuggable: result.target.debuggable,
                    window: result.target.selectedWindow,
                    windows: result.target.windows?.map((window) => window.name),
                },
                screen: result.screen,
                source: result.source,
                sources: result.sources,
                uiKind: result.uiKind,
                warnings: result.warnings,
                ...(result.view ? { view: { window: result.view.window, roots: tree(result.view.roots) } } : {}),
                ...(result.semantics ? { semantics: { rotation: result.semantics.rotation, roots: tree(result.semantics.roots) } } : {}),
                ...(result.compose
                    ? {
                        compose: {
                            rootViewId: result.compose.rootViewId,
                            roots: tree(result.compose.roots),
                        },
                    }
                    : {}),
                ...(args.savePath ? { savedTo: args.savePath } : {}),
                hint: result.source === "semantics"
                    ? "Compose semantics nodes are identified by ref (s*). Use find_elements or hit_test to locate elements."
                    : "View nodes are identified by ref (v*). Use find_elements or hit_test to locate elements.",
            };
            return jsonResult(payload);
        }
        catch (error) {
            return errorResultWithScreenshot(error);
        }
    });
    server.registerTool("find_elements", {
        title: "Find elements",
        description: "Search the current UI tree by text, content description, resource id, class, or node ref. Defaults to a case-insensitive contains match. Returns bounds, center, clickable state, and the full path for each match. This is the best way to locate an element and get its device coordinates. Use this when the user points at a visible control (\"看下当前“登录”按钮\", \"这个控件多大/在哪/可点击吗\", \"顶部那个图标是什么\"); the result includes bounds, center, clickable, enabled, and className. Android repos only; non-Android: call only on an explicit device/screen request or Android mention.",
        inputSchema: {
            query: z.string().describe("Text, id, class, ref, or regex to search for."),
            by: z.enum(["any", "text", "desc", "id", "class", "ref"]).optional().describe("Field to search (default any)."),
            match: z.enum(["contains", "exact", "regex"]).optional().describe("Match mode (default contains; /regex/ syntax is also accepted)."),
            clickable: z.boolean().optional().describe("Only clickable elements."),
            includeInvisible: z.boolean().optional().describe("Include invisible/gone views (view source)."),
            both: z.boolean().optional().describe("Search both view and semantics trees (default: primary tree only)."),
            source: sourceSchema.optional(),
            limit: z.number().int().min(1).max(200).optional().describe("Maximum matches (default 30)."),
            serial: z.string().optional(),
            package: z.string().optional(),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
    }, async (args) => {
        try {
            const captureSource = args.both && (!args.source || args.source === "auto") ? "both" : args.source ?? "auto";
            const result = await captureFor({ serial: args.serial, package: args.package, source: captureSource });
            const limit = args.limit ?? 30;
            const matches = [];
            for (const [treeSource, roots] of treesFor(result, captureSource, args.both)) {
                const found = findNodes(roots, {
                    query: args.query,
                    by: args.by,
                    match: args.match,
                    clickableOnly: args.clickable,
                    visibleOnly: !args.includeInvisible,
                    limit,
                });
                for (const match of found) {
                    matches.push({
                        tree: treeSource,
                        matchedField: match.field,
                        ...nodeSummary(match.node),
                        fullPath: match.path,
                    });
                }
                if (matches.length >= limit)
                    break;
            }
            return jsonResult({
                query: args.query,
                uiKind: result.uiKind,
                matches: matches.slice(0, limit),
                warnings: result.warnings,
                hint: matches.length === 0 ? emptyHint(result) : undefined,
            });
        }
        catch (error) {
            return errorResultWithScreenshot(error);
        }
    });
    server.registerTool("locate_code", {
        title: "Locate code behind a UI element",
        description: "Scan the current Android repository for the source of a UI element. Pass the anchors returned by dump_ui/find_elements: visible text, content description, resource id, Compose name/file/line, or View class. Returns string-resource/layout/Compose anchors plus ranked candidates with file, line, kind, score, reason and a snippet. This is the deterministic step before reading code; it is read-only and does not modify the repository. Use the returned anchors and candidates to open files and trace the click/state chain. Use only when the user references a visible UI element on the current screen or asks where UI code is implemented; not for general Android concept questions, code review, or performance debugging. Android repos only; non-Android: call only on an explicit Android/device request.",
        inputSchema: {
            root: z.string().optional().describe("Repository root (default: the MCP server's working directory)."),
            text: z.array(z.string()).optional().describe("Visible text anchors; repeatable."),
            desc: z.array(z.string()).optional().describe("contentDescription anchors; repeatable."),
            id: z.array(z.string()).optional().describe("Resource ids, with or without package prefix; repeatable."),
            composeName: z.string().optional().describe("Composable function name from dump_ui(source=compose)."),
            composeFile: z.string().optional().describe("File name/path reported by the Compose inspector."),
            composeLine: z.number().int().min(0).optional().describe("Line reported by the Compose inspector."),
            className: z.array(z.string()).optional().describe("View/Compose class names; repeatable."),
            limit: z.number().int().min(1).max(200).optional().describe("Maximum candidates (default 25)."),
            includeTests: z.boolean().optional().describe("Include test sources in the ranking."),
            exclude: z.array(z.string()).optional().describe("Skip path substrings; repeatable."),
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
    }, async (args) => {
        try {
            const hasAnchor = (args.text?.length ?? 0) > 0 ||
                (args.desc?.length ?? 0) > 0 ||
                (args.id?.length ?? 0) > 0 ||
                Boolean(args.composeName) ||
                Boolean(args.composeFile) ||
                (args.className?.length ?? 0) > 0;
            if (!hasAnchor) {
                throw new AuiError("BAD_INPUT", "locate_code needs at least one anchor: text, desc, id, composeName, composeFile, or className.");
            }
            if (!existsSync(LOCATOR_SCRIPT)) {
                throw new AuiError("BAD_INPUT", `Code locator script not found at ${LOCATOR_SCRIPT}.`, "Reinstall the plugin, or run npm run build in the plugin directory.");
            }
            const argv = [
                LOCATOR_SCRIPT,
                "--root",
                args.root ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
                "--json",
                "--limit",
                String(args.limit ?? 25),
            ];
            for (const value of args.text ?? [])
                argv.push("--text", value);
            for (const value of args.desc ?? [])
                argv.push("--desc", value);
            for (const value of args.id ?? [])
                argv.push("--id", value);
            for (const value of args.className ?? [])
                argv.push("--class", value);
            if (args.composeName)
                argv.push("--compose-name", args.composeName);
            if (args.composeFile)
                argv.push("--compose-file", args.composeFile);
            if (args.composeLine !== undefined)
                argv.push("--compose-line", String(args.composeLine));
            if (args.includeTests)
                argv.push("--include-tests");
            for (const value of args.exclude ?? [])
                argv.push("--exclude", value);
            let stdout;
            try {
                const result = await execFileAsync(process.execPath, argv, {
                    timeout: 120_000,
                    maxBuffer: 20 * 1024 * 1024,
                    windowsHide: true,
                });
                stdout = String(result.stdout);
            }
            catch (error) {
                const stderr = typeof error === "object" && error !== null && "stderr" in error
                    ? String(error.stderr ?? "")
                    : "";
                throw new AuiError("BAD_INPUT", stderr.trim() || errorMessage(error));
            }
            return jsonResult(JSON.parse(stdout));
        }
        catch (error) {
            return errorResult(error);
        }
    });
    server.registerTool("hit_test", {
        title: "Hit-test a screen point",
        description: "Return the element(s) at a screen coordinate. Matching mirrors LayoutInspectorV2-Pro: all nodes containing the point are sorted by smallest area, with deeper/later-drawn nodes winning ties. By default both the view and semantics trees are queried, so you get the View class and the Compose/accessibility node for the same point. Set source=compose to hit-test the JVMTI Compose tree instead. Use index to cycle through overlapping candidates. Use for \"屏幕坐标 300,800 是什么\" and \"what is at x,y\"; returns all overlapping candidates by index.",
        inputSchema: {
            x: z.number().int().min(0),
            y: z.number().int().min(0),
            index: z.number().int().min(0).optional().describe("Candidate index for overlapping nodes (default 0)."),
            source: sourceSchema.optional(),
            serial: z.string().optional(),
            package: z.string().optional(),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
    }, async (args) => {
        try {
            const captureSource = args.source === "view" || args.source === "semantics" || args.source === "compose"
                ? args.source
                : "both";
            const result = await captureFor({ serial: args.serial, package: args.package, source: captureSource });
            const index = args.index ?? 0;
            const reports = treesFor(result, captureSource, captureSource === "both").map(([treeSource, roots]) => {
                const candidates = hitTest(roots, args.x, args.y).candidates;
                return {
                    tree: treeSource,
                    selected: candidates[index]
                        ? { index, ...nodeSummary(candidates[index]), path: nodePath(candidates[index]) }
                        : null,
                    candidates: candidates.slice(0, 12).map((node, i) => ({
                        index: i,
                        ...nodeSummary(node),
                        path: nodePath(node),
                    })),
                };
            });
            return jsonResult({
                point: { x: args.x, y: args.y },
                reports,
                warnings: result.warnings,
                hint: "Bounds may overlap; index selects a different candidate. Tap uses the center of the selected node.",
            });
        }
        catch (error) {
            return errorResultWithScreenshot(error);
        }
    });
    server.registerTool("analyze_ui", {
        title: "Analyze layout issues",
        description: "Run layout/accessibility checks over the current UI: tiny touch targets (<48dp by default), overlapping sibling clickables, clipped or offscreen nodes, invisible clickables, unlabeled clickables, duplicate resource ids, deep nesting, and nodes extending outside their parent. Use this after making a UI change to catch regressions. Also answers \"有没有小点击区域\", \"有没有重叠\", \"无障碍检查\", \"布局有没有问题\", and \"有没有错位/被裁剪\".",
        inputSchema: {
            source: sourceSchema.optional(),
            rules: z.array(ruleSchema).optional().describe("Subset of rules; default all."),
            minTouchTargetDp: z.number().min(1).max(200).optional().describe("Minimum touch target in dp (default 48)."),
            maxDepth: z.number().int().min(1).max(100).optional().describe("Deep nesting threshold (default 14)."),
            serial: z.string().optional(),
            package: z.string().optional(),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
    }, async (args) => {
        try {
            const result = await captureFor({ serial: args.serial, package: args.package, source: args.source });
            const analysis = analyzeCapture(result, {
                rules: args.rules,
                minTouchTargetDp: args.minTouchTargetDp,
                maxDepth: args.maxDepth,
            });
            return jsonResult({
                uiKind: result.uiKind,
                ...issuesToJson(analysis),
                warnings: result.warnings,
                hint: analysis.issues.length === 0 ? "No issues detected in the captured tree." : undefined,
            });
        }
        catch (error) {
            return errorResultWithScreenshot(error);
        }
    });
    server.registerTool("list_fragments", {
        title: "List Activity and Fragment structure",
        description: "Report the Activity and Fragment structure of the foreground app from `dumpsys activity`: fragment class (or tag when the class is obfuscated), lifecycle state, and whether it is added/hidden/detached. Works on non-debuggable apps, where the ViewDebug source fails. Framework bookkeeping fragments (AndroidX ReportFragment, LifecycleDispatcher tags) are filtered out. Use this to answer \"which Fragment implements this page\" before scanning source. It returns no view hierarchy; pair it with dump_ui(source=\"dumpsys\") for nodes. Android repos only; non-Android: call only on an explicit device/screen request or Android mention.",
        inputSchema: {
            serial: z.string().optional(),
            package: z.string().optional().describe("Package to inspect; defaults to the foreground app."),
            includeFramework: z
                .boolean()
                .optional()
                .describe("Keep AndroidX lifecycle bookkeeping fragments (ReportFragment etc.)."),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
    }, async (args) => {
        try {
            const adb = adbFor(args.serial);
            const pkg = args.package ?? (await adb.foregroundApp()).packageName;
            if (!pkg)
                throw new AuiError("BAD_INPUT", "Could not determine the foreground app package.");
            const output = await adb.shell(`dumpsys activity ${pkg}`, { timeoutMs: 30_000 });
            const parsed = parseDumpsys(output, { packageName: pkg });
            const fragments = args.includeFramework
                ? allFragments(parsed)
                : notableFragments(allFragments(parsed));
            return jsonResult({
                package: pkg,
                activities: parsed.activities.map((activity) => ({
                    activity: activity.activity,
                    pid: activity.pid,
                    fragments: activity.fragments
                        .filter((fragment) => args.includeFramework ? true : notableFragments([fragment]).length > 0)
                        .map((fragment) => ({
                        className: fragment.className,
                        shortClassName: fragment.shortClassName,
                        tag: fragment.tag,
                        state: fragment.state,
                        added: fragment.added,
                        hidden: fragment.hidden,
                        detached: fragment.detached,
                        containerId: fragment.containerId,
                    })),
                })),
                fragments,
                hint: fragments.length === 0
                    ? "No product Fragments found. The screen may be a single Activity, Compose-only, or a Fragment with an obfuscated name."
                    : undefined,
            });
        }
        catch (error) {
            return errorResultWithScreenshot(error);
        }
    });
    server.registerTool("screenshot", {
        title: "Take a screenshot",
        description: "Capture the device screen as a PNG and return it as image content. This is also the final fallback when structured UI capture fails. By default the image is downscaled to 720px wide to keep responses small; pass fullResolution=true for the native resolution, or maxWidth/scale for a custom size. The text metadata always includes originalWidth/originalHeight, screenWidth/screenHeight, and coordinateMapping.imageToDevice so you can map vision coordinates back to device coordinates before reporting a position. Optionally save the PNG and generate an SVG overlay with node boxes (annotatedPath). Use for \"截个图看看\" and \"看一下画面\". A screenshot cannot reliably reveal text color or font size; do not infer style from pixels.",
        inputSchema: {
            savePath: z.string().optional().describe("Write the PNG here (e.g. screenshot.png)."),
            annotate: z.boolean().optional().describe("Also write an .annotated.svg with node boxes next to savePath."),
            maxWidth: z.number().int().min(1).max(4000).optional().describe("Downscale to at most this width (default 720)."),
            scale: z.number().min(0.05).max(1).optional().describe("Downscale by this factor (alternative to maxWidth)."),
            fullResolution: z.boolean().optional().describe("Return the native resolution instead of the default 720px width."),
            serial: z.string().optional(),
            package: z.string().optional(),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
    }, async (args) => {
        try {
            const adb = adbFor(args.serial);
            const shot = await takeScreenshot(adb, {
                maxWidth: args.fullResolution ? undefined : args.maxWidth ?? 720,
                scale: args.scale,
            });
            let annotatedPath;
            if (args.savePath) {
                await saveScreenshot(shot, args.savePath);
                if (args.annotate) {
                    const result = await captureFor({ serial: args.serial, package: args.package });
                    const trees = treesFor(result, undefined, false);
                    const [treeSource, roots] = trees[0];
                    annotatedPath = args.savePath.replace(/\.png$/i, "") + ".annotated.svg";
                    await writeFile(annotatedPath, renderAnnotatedSvg(roots, {
                        pngFileName: args.savePath.split(/[\\/]/).pop() ?? "screenshot.png",
                        width: shot.width,
                        height: shot.height,
                        uiScale: shot.scale,
                        title: `${treeSource} ${shot.width}x${shot.height}`,
                    }));
                }
            }
            const meta = {
                ...screenshotMetadata(shot),
                savedTo: args.savePath,
                annotatedPath,
                hint: shot.scale < 1
                    ? "This image is downscaled. Coordinates read from the image are NOT device coordinates; multiply by coordinateMapping.imageToDevice before reporting a position."
                    : "Coordinates in this image are device coordinates.",
            };
            return {
                content: [
                    { type: "image", data: shot.buffer.toString("base64"), mimeType: "image/png" },
                    { type: "text", text: JSON.stringify(meta) },
                ],
            };
        }
        catch (error) {
            return errorResultWithScreenshot(error);
        }
    });
    await server.connect(new StdioServerTransport());
    console.error(`[android-layout] MCP server ready${options.serial ? ` (serial ${options.serial})` : ""}`);
}
function emptyHint(result) {
    if (result.source === "view" && result.semantics) {
        return "The view tree has no match. If this is a Compose app, retry with source=semantics or both=true.";
    }
    return "No element matched. Try match=contains, a shorter query, or dump_ui to inspect available refs/text.";
}
function jsonResult(value) {
    return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
function textResult(text) {
    return { content: [{ type: "text", text }] };
}
function errorResult(error) {
    const message = errorMessage(error);
    return { isError: true, content: [{ type: "text", text: `Error: ${message}` }] };
}
/**
 * Allows `node dist/mcp.js` to be used directly as an MCP stdio server.
 * Arguments mirror the CLI's Compose-related globals.
 */
function parseServerArgs(argv) {
    const options = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--serial" || arg === "-s")
            options.serial = argv[++i];
        else if (arg === "--adb")
            options.adb = argv[++i];
        else if (arg === "--timeout")
            options.timeout = Number.parseInt(argv[++i], 10);
        else if (arg === "--studio")
            options.studioPath = argv[++i];
        else if (arg === "--java")
            options.javaPath = argv[++i];
        else if (arg === "--compose-version")
            options.composeVersion = argv[++i];
        else if (arg === "--help" || arg === "-h") {
            console.error("Usage: node mcp.js [--serial <serial>] [--adb <path>] [--timeout <ms>]\n" +
                "       [--studio <path>] [--java <path>] [--compose-version <version>]\n" +
                "Starts the Android Layout MCP MCP server over stdio.");
            process.exit(0);
        }
        else {
            console.error(`Unknown argument "${arg}". Use --help.`);
            process.exit(2);
        }
    }
    return options;
}
const invokedDirectly = process.argv[1] !== undefined &&
    pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
    startMcpServer(parseServerArgs(process.argv.slice(2))).catch((error) => {
        console.error(`[android-layout] failed to start: ${errorMessage(error)}`);
        process.exit(1);
    });
}
