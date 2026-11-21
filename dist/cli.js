#!/usr/bin/env node
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { Command } from "commander";
import { Adb } from "./core/adb.js";
import { analyzeCapture, issuesToJson } from "./core/analyze.js";
import { capture } from "./core/capture.js";
import { detectRunningStudioRoots, locateAndroidStudio } from "./core/compose.js";
import { diffSnapshots, renderDiff } from "./core/diff.js";
import { DliError, errorMessage } from "./core/errors.js";
import { JdwpClient } from "./core/jdwp.js";
import { findNodes, nodePath, nodeSummary } from "./core/query.js";
import { renderCapture, renderIssues } from "./core/render.js";
import { imageToDevicePoint, renderAnnotatedSvg, saveScreenshot, screenshotMetadata, takeScreenshot, } from "./core/screenshot.js";
import { flattenNodes, serializeNode } from "./core/viewdump.js";
import { loadDump, saveDump, serializeDump, snapshotRoots, chooseDiffSource } from "./core/serialize.js";
const VERSION = "0.1.0";
const program = new Command();
program
    .name("layout-inspector")
    .description("Inspect Android layouts from a terminal.\n\n" +
    "Captures the ViewDebug hierarchy over JDWP (like LayoutInspectorV2-Pro) and the\n" +
    "accessibility/semantics tree via uiautomator, then offers hit-testing, search,\n" +
    "screenshot and layout analysis.")
    .version(VERSION)
    .option("-s, --serial <serial>", "device serial (defaults to ANDROID_SERIAL or the only device)")
    .option("--adb <path>", "path to adb (defaults to DLI_ADB, ADB_PATH, or adb on PATH)")
    .option("--timeout <ms>", "adb/JDWP timeout in milliseconds", parsePositiveInt, 30_000)
    .option("--studio <path>", "Android Studio installation directory (Compose inspection)")
    .option("--java <path>", "Java executable for the Compose inspector helper")
    .option("--compose-version <version>", "Compose version used to fetch inspector.jar (defaults to DLI_COMPOSE_VERSION or 1.8.3)")
    .option("-v, --verbose", "print capture progress on stderr")
    .option("--no-fallback-screenshot", "do not save a device screenshot when UI capture fails");
program
    .command("devices")
    .description("list connected Android devices")
    .option("--json", "output JSON")
    .action(async (options, command) => {
    const adb = makeAdb(command);
    const devices = await adb.devices();
    if (options.json) {
        printJson(devices);
        return;
    }
    if (devices.length === 0) {
        console.log("No devices found.");
        return;
    }
    for (const device of devices) {
        console.log(`${device.serial}  ${device.state}` +
            `${device.model ? `  model=${device.model}` : ""}` +
            `${device.manufacturer ? `  manufacturer=${device.manufacturer}` : ""}` +
            `${device.androidRelease ? `  android=${device.androidRelease}` : ""}` +
            `${device.sdk !== null ? `  sdk=${device.sdk}` : ""}`);
    }
});
program
    .command("state")
    .description("show device, screen, foreground app, and windows")
    .option("--json", "output JSON")
    .action(async (options, command) => {
    const adb = makeAdb(command);
    const device = await adb.resolveDevice();
    const [screen, foreground] = await Promise.all([adb.screenInfo(), adb.foregroundApp()]);
    const pids = foreground.packageName ? await adb.packagePids(foreground.packageName) : [];
    let windows = [];
    if (pids[0]) {
        try {
            const client = await JdwpClient.open(adb, pids[0], { requestTimeoutMs: 5000 });
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
    const result = { device, screen, foreground, pids, windows };
    if (options.json) {
        printJson(result);
        return;
    }
    console.log(`device: ${device.serial} (${device.model ?? "?"}) android ${device.androidRelease ?? "?"} sdk ${device.sdk ?? "?"}`);
    console.log(`screen: ${screen.width}x${screen.height} @ ${screen.densityDpi}dpi (${screen.density.toFixed(2)}x) ${screen.orientation}`);
    console.log(`foreground: ${foreground.packageName ?? "?"}${foreground.activity ? `/${foreground.activity}` : ""}${pids.length ? ` pid=${pids.join(",")}` : ""}`);
    if (Array.isArray(windows) && windows.length > 0) {
        console.log("windows:");
        for (const window of windows)
            console.log(`  ${window.index}: ${window.name}`);
    }
    else if (windows && !Array.isArray(windows)) {
        console.log(`windows: unavailable (${windows.error ?? "unknown"})`);
    }
});
program
    .command("studio")
    .description("locate the Android Studio installation used for Compose inspection")
    .option("--json", "output JSON")
    .action(async (options, command) => {
    const globals = globalOptions(command);
    const studio = await locateAndroidStudio(globals.studio);
    const runningProcessRoots = await detectRunningStudioRoots();
    const result = {
        root: studio.root,
        source: studio.source,
        version: studio.version,
        buildNumber: studio.buildNumber,
        java: studio.java,
        javac: studio.javac,
        resources: studio.resources,
        lib: studio.lib,
        runningProcessRoots,
    };
    if (options.json) {
        printJson(result);
        return;
    }
    console.log(`studio: ${studio.root} (${studio.source})`);
    if (studio.version || studio.buildNumber) {
        console.log(`build:  ${studio.version ?? studio.buildNumber}`);
    }
    console.log(`java:   ${studio.java ?? "not found (JAVA_HOME/PATH will be used)"}`);
    console.log(`javac:  ${studio.javac ?? "not found (packaged helper will be used)"}`);
    console.log(`lib:    ${studio.lib}`);
    if (runningProcessRoots.length > 0) {
        console.log(`running process roots: ${runningProcessRoots.join(", ")}`);
    }
});
program
    .command("windows")
    .description("list ViewRootImpl windows reported by the app over JDWP")
    .option("--package <package>", "package name (defaults to foreground app)")
    .option("--pid <pid>", "process id")
    .option("--json", "output JSON")
    .action(async (options, command) => {
    const adb = makeAdb(command);
    const target = await resolvePackage(adb, options.package, options.pid);
    if (target.pid === null)
        throw new DliError("NO_PID", `No running process for ${target.packageName}.`);
    const client = await JdwpClient.open(adb, target.pid, { requestTimeoutMs: 10_000 });
    try {
        const windows = await client.listWindows();
        if (options.json) {
            printJson({ package: target.packageName, pid: target.pid, windows });
            return;
        }
        for (const window of windows)
            console.log(`${window.index}: ${window.name}`);
    }
    finally {
        await client.close();
    }
});
program
    .command("dump")
    .description("capture the current UI hierarchy")
    .option("--source <mode>", "auto | view | semantics | compose | both", "auto")
    .option("--package <package>", "package name (defaults to foreground app)")
    .option("--pid <pid>", "process id")
    .option("--window <name-or-index>", "ViewRootImpl window to dump (view source)")
    .option("--depth <n>", "limit tree depth", parseNonNegativeInt)
    .option("--max-nodes <n>", "limit rendered nodes in text output", parsePositiveInt, 2000)
    .option("--visible-only", "hide invisible/gone views in text output")
    .option("--props", "include every ViewDebug property")
    .option("--json", "output JSON (dump file format)")
    .option("--out <file>", "write the JSON dump to a file")
    .action(async (options, command) => {
    const result = await captureFor(command, options);
    const source = parseSource(options.source);
    if (options.json || options.out) {
        const file = serializeDump(result, options.props);
        if (options.out) {
            await saveDump(result, options.out);
            if (!options.json) {
                console.log(`captured ${options.out}`);
                return;
            }
        }
        if (options.json)
            printJson(file);
        return;
    }
    console.log(renderCapture(result, source === "both" ? "both" : source === "view" ? "view" : source === "semantics" ? "semantics" : source === "compose" ? "compose" : undefined, {
        depth: options.depth,
        maxNodes: options.maxNodes,
        visibleOnly: options.visibleOnly,
        showCenter: true,
    }));
});
program
    .command("find <query>")
    .description("search the UI tree by text, content description, id, class, or ref")
    .option("--by <field>", "any | text | desc | id | class | ref", "any")
    .option("--match <mode>", "contains | exact | regex", "contains")
    .option("--clickable", "only clickable nodes")
    .option("--both", "search both view and semantics trees")
    .option("--source <mode>", "auto | view | semantics | compose | both", "auto")
    .option("--limit <n>", "maximum matches", parsePositiveInt, 50)
    .option("--json", "output JSON")
    .action(async (query, options, command) => {
    const result = await captureFor(command, {
        ...options,
        source: options.both ? "both" : options.source,
    });
    const matches = [];
    const trees = treesFor(result, parseSource(options.source), options.both);
    for (const [treeSource, roots] of trees) {
        const found = findNodes(roots, {
            query,
            by: options.by,
            match: options.match,
            clickableOnly: options.clickable,
            limit: options.limit,
        });
        for (const match of found) {
            matches.push({ ...nodeSummary(match.node), matchedField: match.field, fullPath: match.path, tree: treeSource });
        }
    }
    const limited = matches.slice(0, options.limit);
    if (options.json) {
        printJson(limited);
        return;
    }
    if (limited.length === 0) {
        console.log("No matches.");
        return;
    }
    for (const match of limited)
        console.log(formatMatch(match));
});
program
    .command("hit <x> <y>")
    .description("find the view(s) at a screen coordinate (smallest area wins)")
    .option("--both", "hit-test both view and semantics trees")
    .option("--source <mode>", "auto | view | semantics | compose | both", "auto")
    .option("--index <n>", "select the n-th candidate at the same point (cycles overlapping views)", parseNonNegativeInt, 0)
    .option("--json", "output JSON")
    .action(async (xArg, yArg, options, command) => {
    const x = parseCoordinate(xArg, "x");
    const y = parseCoordinate(yArg, "y");
    const result = await captureFor(command, {
        ...options,
        source: options.both ? "both" : options.source,
    });
    const trees = treesFor(result, parseSource(options.source), options.both);
    const reports = trees.map(([treeSource, roots]) => {
        const hit = hitTestRoots(roots, x, y);
        return {
            tree: treeSource,
            point: hit.point,
            selected: hit.candidates[options.index] ?? null,
            candidates: hit.candidates,
        };
    });
    if (options.json) {
        printJson(reports.map((report) => ({
            tree: report.tree,
            point: report.point,
            selected: report.selected ? nodeSummary(report.selected) : null,
            candidates: report.candidates.map((node) => nodeSummary(node)),
        })));
        return;
    }
    for (const report of reports) {
        console.log(`── ${report.tree} ──`);
        if (!report.selected) {
            console.log(`(${x}, ${y}) no node found`);
            continue;
        }
        const node = report.selected;
        console.log(`(${x}, ${y}) -> ${node.ref} ${node.shortClassName}` +
            `${node.text ? ` "${node.text}"` : node.contentDescription ? ` "${node.contentDescription}"` : ""}`);
        console.log(`  bounds [${node.bounds.left},${node.bounds.top}][${node.bounds.right},${node.bounds.bottom}] center (${Math.round(node.center.x)},${Math.round(node.center.y)})`);
        console.log(`  path ${nodePath(node)}`);
        if (report.candidates.length > 1) {
            console.log(`  ${report.candidates.length} candidates at this point:`);
            report.candidates.slice(0, 8).forEach((candidate, index) => {
                console.log(`    ${index === options.index ? "*" : " "} ${candidate.ref} ${candidate.shortClassName}` +
                    ` [${candidate.bounds.width}x${candidate.bounds.height}]` +
                    `${candidate.text ? ` "${candidate.text}"` : ""}`);
            });
        }
    }
});
program
    .command("analyze")
    .description("report layout and accessibility issues")
    .option("--source <mode>", "auto | view | semantics | compose | both", "auto")
    .option("--rules <rules>", "comma-separated rules (small_touch_target, overlap, clipped, ...)")
    .option("--min-touch-dp <dp>", "minimum touch target size", parsePositiveInt, 48)
    .option("--max-depth <n>", "deep nesting threshold", parsePositiveInt, 14)
    .option("--json", "output JSON")
    .option("--paths", "include full node paths in text output")
    .action(async (options, command) => {
    const result = await captureFor(command, options);
    const rules = options.rules
        ? options.rules.split(",").map((rule) => rule.trim()).filter(Boolean)
        : undefined;
    const analysis = analyzeCapture(result, {
        rules,
        minTouchTargetDp: options.minTouchDp,
        maxDepth: options.maxDepth,
    });
    if (options.json) {
        printJson(issuesToJson(analysis));
        return;
    }
    console.log(renderIssues(analysis, { showPaths: options.paths }));
    for (const warning of result.warnings)
        console.error(`warning: ${warning}`);
});
program
    .command("inspect <ref-or-path>")
    .description("show full details for one node (ref like v12/s12 or id path like 0.2.1)")
    .option("--source <mode>", "auto | view | semantics | compose | both", "auto")
    .option("--json", "output JSON (default)")
    .action(async (ref, options, command) => {
    const result = await captureFor(command, { ...options, props: true });
    const trees = treesFor(result, parseSource(options.source), options.source === "both");
    for (const [, roots] of trees) {
        const node = flattenNodes(roots).find((candidate) => candidate.ref === ref || candidate.id === ref);
        if (node) {
            printJson(serializeNode(node, { includeProps: true }));
            return;
        }
    }
    throw new DliError("BAD_INPUT", `No node with ref/id "${ref}" in the current UI.`);
});
program
    .command("shot")
    .description("save a PNG screenshot, optionally with a node-box overlay")
    .option("--out <file>", "output PNG path", "screenshot.png")
    .option("--annotate", "also write an .annotated.svg with node boxes")
    .option("--source <mode>", "auto | view | semantics | compose | both", "auto")
    .option("--max-width <px>", "downscale the screenshot to at most this width", parsePositiveInt)
    .option("--scale <factor>", "downscale by a factor between 0 and 1", parseScale)
    .option("--json", "print metadata (base64 with --base64)")
    .option("--base64", "include base64 PNG data in JSON output")
    .action(async (options, command) => {
    const adb = makeAdb(command);
    const screenshot = await takeScreenshot(adb, {
        maxWidth: options.maxWidth,
        scale: options.scale,
    });
    await saveScreenshot(screenshot, options.out);
    let annotated = null;
    if (options.annotate) {
        const result = await captureFor(command, options);
        const trees = treesFor(result, parseSource(options.source), false);
        const [treeSource, roots] = trees[0];
        const svgPath = options.out.replace(/\.png$/i, "") + ".annotated.svg";
        annotated = svgPath;
        await writeFile(svgPath, renderAnnotatedSvg(roots, {
            pngFileName: basename(options.out),
            width: screenshot.width,
            height: screenshot.height,
            uiScale: screenshot.scale,
            title: `${treeSource} ${screenshot.width}x${screenshot.height}`,
        }));
    }
    const metadata = screenshotMetadata(screenshot);
    if (options.json) {
        printJson({
            path: options.out,
            ...metadata,
            annotated,
            ...(options.base64 ? { base64: screenshot.buffer.toString("base64") } : {}),
        });
        return;
    }
    if (screenshot.scale < 1) {
        console.log(`saved ${options.out} (${screenshot.width}x${screenshot.height}, ` +
            `downscaled from ${screenshot.originalWidth}x${screenshot.originalHeight}; ` +
            `image→device ×${metadata.coordinateMapping.imageToDevice.x}/${metadata.coordinateMapping.imageToDevice.y})`);
    }
    else {
        console.log(`saved ${options.out} (${screenshot.width}x${screenshot.height})`);
    }
    if (annotated)
        console.log(`saved ${annotated}`);
});
program
    .command("diff <before> <after>")
    .description("diff two dump JSON files")
    .option("--source <source>", "view | semantics | compose (defaults to each dump's primary source)")
    .option("--tolerance <px>", "bounds tolerance in pixels", parseNonNegativeInt, 1)
    .option("--json", "output JSON")
    .action(async (beforePath, afterPath, options) => {
    const [before, after] = await Promise.all([loadDump(beforePath), loadDump(afterPath)]);
    const source = options.source ? options.source : undefined;
    const chosen = chooseDiffSource(before, after, source);
    const result = diffSnapshots(snapshotRoots(before, chosen), snapshotRoots(after, chosen), { source: chosen, boundsTolerance: options.tolerance });
    if (options.json) {
        printJson({
            summary: result.summary,
            before: { source: chosen, file: beforePath },
            after: { source: chosen, file: afterPath },
            added: result.added,
            removed: result.removed,
            changed: result.changed,
        });
        return;
    }
    console.log(renderDiff(result));
});
program
    .command("tap")
    .description("tap coordinates, or the center of a matched element")
    .argument("[x]", "screen x coordinate")
    .argument("[y]", "screen y coordinate")
    .option("--text <text>", "match element text/description")
    .option("--id <resource-id>", "match resource id")
    .option("--ref <ref>", "match node ref (v12/s12)")
    .option("--by <field>", "any | text | desc | id | class | ref", "any")
    .option("--match <mode>", "contains | exact | regex", "contains")
    .option("--index <n>", "match index", parseNonNegativeInt, 0)
    .option("--source <mode>", "auto | view | semantics | compose | both", "auto")
    .option("--image-x <px>", "x in the downscaled screenshot image")
    .option("--image-y <px>", "y in the downscaled screenshot image")
    .option("--image-width <px>", "screenshot image width reported by `shot`")
    .option("--image-height <px>", "screenshot image height reported by `shot`")
    .action(async (xArg, yArg, options, command) => {
    const adb = makeAdb(command);
    let point = null;
    let node = null;
    const imageOptions = [
        options.imageX,
        options.imageY,
        options.imageWidth,
        options.imageHeight,
    ];
    if (imageOptions.some((value) => value !== undefined)) {
        if (imageOptions.some((value) => value === undefined)) {
            throw new DliError("BAD_INPUT", "Image-coordinate tap needs --image-x, --image-y, --image-width, and --image-height.");
        }
        const screen = await adb.screenInfo();
        if (!screen.width || !screen.height) {
            throw new DliError("BAD_INPUT", "Could not determine the device screen size for image-coordinate mapping.");
        }
        point = imageToDevicePoint(parseImageCoordinate(options.imageX, "image-x"), parseImageCoordinate(options.imageY, "image-y"), parseNonNegativeInt(options.imageWidth), parseNonNegativeInt(options.imageHeight), screen.width, screen.height);
        console.log(`image (${options.imageX}, ${options.imageY}) in ${options.imageWidth}x${options.imageHeight} ` +
            `-> device (${point.x}, ${point.y}) on ${screen.width}x${screen.height}`);
    }
    else if (xArg !== undefined || yArg !== undefined) {
        if (xArg === undefined || yArg === undefined) {
            throw new DliError("BAD_INPUT", "tap needs both x and y, or a selector (--text/--id/--ref).");
        }
        point = { x: parseCoordinate(xArg, "x"), y: parseCoordinate(yArg, "y") };
    }
    else {
        const result = await captureFor(command, {
            ...options,
            source: options.ref && (!options.source || options.source === "auto") ? "both" : options.source,
        });
        const trees = treesFor(result, parseSource(options.source), options.ref !== undefined && (!options.source || options.source === "auto"));
        const [treeSource, roots] = trees[0];
        const query = options.ref || options.text || options.id;
        if (!query) {
            throw new DliError("BAD_INPUT", "tap needs coordinates or --text/--id/--ref.");
        }
        const by = options.ref ? "ref" : options.id ? "id" : options.text ? options.by : options.by;
        const matches = findNodes(roots, {
            query,
            by,
            match: options.match,
            visibleOnly: true,
        });
        node = matches[options.index]?.node ?? null;
        if (!node) {
            throw new DliError("BAD_INPUT", `No visible ${treeSource} node matches "${query}" (--by ${by}).`);
        }
        point = node.center;
    }
    await adb.inputTap(point.x, point.y);
    console.log(`tapped (${Math.round(point.x)}, ${Math.round(point.y)})`);
    if (node)
        console.log(`node ${node.ref} ${nodePath(node)}`);
});
program
    .command("swipe <x1> <y1> <x2> <y2>")
    .description("swipe between two screen coordinates")
    .option("--duration <ms>", "swipe duration", parsePositiveInt, 300)
    .action(async (x1, y1, x2, y2, options, command) => {
    const adb = makeAdb(command);
    await adb.inputSwipe(parseCoordinate(x1, "x1"), parseCoordinate(y1, "y1"), parseCoordinate(x2, "x2"), parseCoordinate(y2, "y2"), options.duration);
    console.log("swiped");
});
program
    .command("input <text>")
    .description("type text into the focused field (ASCII)")
    .action(async (text, _options, command) => {
    const adb = makeAdb(command);
    await adb.inputText(text);
    console.log("text sent");
});
program
    .command("key <keycode>")
    .description("send a key event, e.g. KEYCODE_BACK, KEYCODE_ENTER, or 4")
    .action(async (key, _options, command) => {
    const adb = makeAdb(command);
    await adb.keyEvent(key);
    console.log(`key ${key} sent`);
});
program
    .command("compose-clean")
    .description("stop the Compose inspector daemon and remove its device-side artifacts")
    .option("--package <package>", "package whose code_cache should be cleaned (defaults to foreground app)")
    .action(async (options, command) => {
    const adb = makeAdb(command);
    await adb
        .shell("pkill -f /data/local/tmp/dli-compose/daemon.config 2>/dev/null", {
        timeoutMs: 10_000,
        allowFailure: true,
    })
        .catch(() => undefined);
    await adb.shell("rm -rf /data/local/tmp/dli-compose", { timeoutMs: 15_000, allowFailure: true });
    const foreground = await adb.foregroundApp();
    const packageName = options.package || foreground.packageName;
    if (packageName) {
        await adb
            .shell(`run-as ${packageName} sh -c 'cd code_cache && rm -f dli-view-inspector.jar dli-compose-inspector-*.jar libjvmtiagent_*.so perfa.jar transport'`, { timeoutMs: 20_000, allowFailure: true })
            .catch(() => undefined);
        console.log(`cleaned Compose inspector artifacts for ${packageName}`);
    }
    else {
        console.log("cleaned Compose inspector daemon artifacts");
    }
});
program
    .command("mcp")
    .description("start an MCP server (stdio) exposing layout-inspection tools")
    .option("--print-config", "print an MCP client config snippet and exit")
    .option("--register-view-attributes", "set the debug_view_attributes global setting (restarts the app)")
    .action(async (options, command) => {
    const globals = globalOptions(command);
    if (options.printConfig) {
        const serverPath = fileURLToPath(new URL("./mcp.js", import.meta.url));
        const config = {
            mcpServers: {
                "layout-inspector-android": {
                    command: "node",
                    args: [
                        serverPath,
                        ...(globals.serial ? ["--serial", globals.serial] : []),
                        ...(globals.adb ? ["--adb", globals.adb] : []),
                        ...(globals.timeout !== 30_000 ? ["--timeout", String(globals.timeout)] : []),
                        ...(globals.studio ? ["--studio", globals.studio] : []),
                        ...(globals.java ? ["--java", globals.java] : []),
                        ...(globals.composeVersion ? ["--compose-version", globals.composeVersion] : []),
                    ],
                    env: {},
                },
            },
        };
        printJson(config);
        return;
    }
    if (options.registerViewAttributes) {
        const adb = makeAdb(command);
        const ok = await adb.installViewAttributesFlag();
        console.error(ok ? "debug_view_attributes enabled (the app must restart)" : "could not enable debug_view_attributes");
    }
    const { startMcpServer } = await import("./mcp.js");
    await startMcpServer(globals);
});
program.showHelpAfterError();
await program.parseAsync(process.argv).catch((error) => {
    const message = errorMessage(error);
    console.error(`error: ${message}`);
    process.exitCode = 1;
});
function makeAdb(command) {
    const globals = globalOptions(command);
    return new Adb({ adbPath: globals.adb, serial: globals.serial, timeoutMs: globals.timeout });
}
function globalOptions(command) {
    const merged = command.optsWithGlobals();
    return {
        serial: asString(merged.serial),
        adb: asString(merged.adb),
        timeout: Number(merged.timeout ?? 30_000),
        verbose: Boolean(merged.verbose),
        studio: asString(merged.studio),
        java: asString(merged.java),
        composeVersion: asString(merged.composeVersion),
        fallbackScreenshot: merged.fallbackScreenshot !== false,
    };
}
async function captureFor(command, options) {
    const globals = globalOptions(command);
    const adb = makeAdb(command);
    const captureOptions = {
        adb,
        source: parseSource(options.source),
        packageName: options.package,
        pid: options.pid ? parsePositiveInt(options.pid) : undefined,
        window: options.window,
        includeProperties: options.props,
        requestTimeoutMs: globals.timeout,
        studioPath: globals.studio,
        javaPath: globals.java,
        composeVersion: globals.composeVersion,
        onProgress: globals.verbose || options.verbose ? (message) => console.error(`[layout-inspector] ${message}`) : undefined,
    };
    try {
        return await capture(captureOptions);
    }
    catch (error) {
        if (globals.fallbackScreenshot !== false) {
            try {
                const shot = await takeScreenshot(adb, { maxWidth: 720 });
                const stamp = new Date().toISOString().replace(/[:.]/g, "-");
                const path = join(process.cwd(), `dli-fallback-${stamp}.png`);
                await saveScreenshot(shot, path);
                const metadata = screenshotMetadata(shot);
                const code = error instanceof DliError ? error.code : "VIEW_DUMP_FAILED";
                const hint = error instanceof DliError ? error.hint : undefined;
                throw new DliError(code, `${errorMessage(error)}
Fallback screenshot: ${path} ` +
                    `(${shot.width}x${shot.height} from ${shot.originalWidth}x${shot.originalHeight}; ` +
                    `image→device ×${metadata.coordinateMapping.imageToDevice.x}/${metadata.coordinateMapping.imageToDevice.y})`, hint);
            }
            catch (fallbackError) {
                if (fallbackError instanceof DliError && fallbackError.message.includes("Fallback screenshot:")) {
                    throw fallbackError;
                }
            }
        }
        throw error;
    }
}
function parseSource(value) {
    if (value === undefined || value === "auto")
        return "auto";
    if (value === "view" || value === "semantics" || value === "compose" || value === "both")
        return value;
    throw new DliError("BAD_INPUT", `Invalid --source "${value}" (expected auto, view, semantics, compose, or both).`);
}
function treesFor(result, source, both) {
    const trees = [];
    const mode = both ? "both" : source ?? "auto";
    if (mode === "compose") {
        if (result.compose)
            trees.push(["compose", result.compose.roots]);
    }
    else if (mode === "both" || mode === "auto") {
        if (mode === "both") {
            if (result.view)
                trees.push(["view", result.view.roots]);
            if (result.semantics)
                trees.push(["semantics", result.semantics.roots]);
        }
        else if (result.uiKind === "mixed" && result.view && result.semantics) {
            trees.push(["view", result.view.roots]);
            trees.push(["semantics", result.semantics.roots]);
        }
        else if (result.source === "semantics" && result.semantics) {
            trees.push(["semantics", result.semantics.roots]);
        }
        else if (result.view) {
            trees.push(["view", result.view.roots]);
        }
        else if (result.semantics) {
            trees.push(["semantics", result.semantics.roots]);
        }
    }
    else if (mode === "view") {
        if (result.view)
            trees.push(["view", result.view.roots]);
    }
    else if (mode === "semantics") {
        if (result.semantics)
            trees.push(["semantics", result.semantics.roots]);
    }
    if (trees.length === 0) {
        throw new DliError("VIEW_DUMP_FAILED", `The ${mode} tree is not available.` +
            (result.warnings.length ? ` ${result.warnings.join(" | ")}` : ""));
    }
    return trees;
}
function hitTestRoots(roots, x, y) {
    const candidates = [];
    for (const node of flattenNodes(roots)) {
        if (!node.visible)
            continue;
        const bounds = node.visibleBounds ?? node.bounds;
        if (x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom) {
            candidates.push(node);
        }
    }
    candidates.sort((a, b) => {
        const areaA = (a.visibleBounds ?? a.bounds).width * (a.visibleBounds ?? a.bounds).height;
        const areaB = (b.visibleBounds ?? b.bounds).width * (b.visibleBounds ?? b.bounds).height;
        if (areaA !== areaB)
            return areaA - areaB;
        if (a.depth !== b.depth)
            return b.depth - a.depth;
        return b.index - a.index;
    });
    return { point: { x, y }, candidates };
}
async function resolvePackage(adb, packageOption, pidOption) {
    const foreground = await adb.foregroundApp();
    const packageName = packageOption || foreground.packageName;
    if (!packageName)
        throw new DliError("BAD_INPUT", "No package specified and no foreground app detected.");
    const pid = pidOption ? parsePositiveInt(pidOption) : (await adb.packagePids(packageName))[0] ?? null;
    return { packageName, pid };
}
function formatMatch(match) {
    const bounds = match.bounds;
    const center = match.center;
    const text = match.text || match.contentDescription;
    return (`${match.ref} [${match.tree}] ${match.className}` +
        `${text ? ` "${text}"` : ""}` +
        `${match.resourceId ? ` ${match.resourceId}` : ""}` +
        ` [${bounds.left},${bounds.top}][${bounds.right},${bounds.bottom}] center=(${center.x},${center.y})` +
        `${match.clickable ? " click" : ""}` +
        `\n    ${match.fullPath}`);
}
function printJson(value) {
    console.log(JSON.stringify(value, null, 2));
}
function asString(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function parseImageCoordinate(value, name) {
    const parsed = typeof value === "number" ? value : Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new DliError("BAD_INPUT", `Invalid ${name} coordinate: ${value}`);
    }
    return parsed;
}
function parseCoordinate(value, name) {
    const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new DliError("BAD_INPUT", `Invalid ${name} coordinate: ${value}`);
    }
    return parsed;
}
function parsePositiveInt(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0)
        throw new Error(`Expected a positive integer, got "${value}"`);
    return parsed;
}
function parseScale(value) {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
        throw new Error(`Expected a scale between 0 and 1, got "${value}"`);
    }
    return parsed;
}
function parseNonNegativeInt(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0)
        throw new Error(`Expected a non-negative integer, got "${value}"`);
    return parsed;
}
