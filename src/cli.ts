#!/usr/bin/env node
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { Command, Option } from "commander";
import { Adb } from "./core/adb.js";
import { analyzeCapture, issuesToJson, type RuleName } from "./core/analyze.js";
import { capture, treesFor, type CaptureOptions } from "./core/capture.js";
import { detectRunningStudioRoots, locateAndroidStudio } from "./core/compose.js";
import { diffSnapshots, renderDiff } from "./core/diff.js";
import { AuiError, errorMessage } from "./core/errors.js";
import { JdwpClient } from "./core/jdwp.js";
import { MCP_CLIENT_IDS, mcpClientConfig, isMcpClient } from "./core/mcp-config.js";
import type { CaptureResult, NodeSource, SourceMode, UiNode } from "./core/model.js";
import { findNodes, hitTest, nodePath, nodeSummary, type FindBy, type MatchMode } from "./core/query.js";
import { renderCapture, renderIssues, renderSource } from "./core/render.js";
import {
  imageToDevicePoint,
  renderAnnotatedSvg,
  saveScreenshot,
  screenshotMetadata,
  takeScreenshot,
  type Screenshot,
} from "./core/screenshot.js";
import { flattenNodes, serializeNode } from "./core/viewdump.js";
import { loadDump, saveDump, serializeDump, snapshotRoots, chooseDiffSource } from "./core/serialize.js";
import { defaultViewerPath, openInBrowser, renderViewerHtmlFromPayload, viewerPayload, type ViewerPayload } from "./core/viewer.js";
import { PACKAGE_VERSION } from "./core/version.js";

interface GlobalOptions {
  serial?: string;
  adb?: string;
  timeout: number;
  verbose?: boolean;
  studio?: string;
  java?: string;
  composeVersion?: string;
  fallbackScreenshot?: boolean;
}

interface CaptureCommandOptions {
  source?: SourceMode;
  package?: string;
  pid?: string;
  window?: string;
  props?: boolean;
  verbose?: boolean;
}

const program = new Command();
program
  .name("android-ui")
  .description(
    "Inspect Android UI from a terminal.\n\n" +
      "Captures the ViewDebug hierarchy over JDWP (like LayoutInspectorV2-Pro) and the\n" +
      "accessibility/semantics tree via uiautomator, then offers hit-testing, search,\n" +
      "screenshot and layout analysis.",
  )
  .version(PACKAGE_VERSION)
  .option("-s, --serial <serial>", "device serial (defaults to ANDROID_SERIAL or the only device)")
  .option("--adb <path>", "path to adb (defaults to AUI_ADB, ADB_PATH, or adb on PATH)")
  .option("--timeout <ms>", "adb/JDWP timeout in milliseconds", parsePositiveInt, 30_000)
  .option("--studio <path>", "Android Studio installation directory (Compose inspection)")
  .option("--java <path>", "Java executable for the Compose inspector helper")
  .option("--compose-version <version>", "Compose version used to fetch inspector.jar (defaults to AUI_COMPOSE_VERSION or 1.8.3)")
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
      console.log(
        `${device.serial}  ${device.state}` +
          `${device.model ? `  model=${device.model}` : ""}` +
          `${device.manufacturer ? `  manufacturer=${device.manufacturer}` : ""}` +
          `${device.androidRelease ? `  android=${device.androidRelease}` : ""}` +
          `${device.sdk !== null ? `  sdk=${device.sdk}` : ""}`,
      );
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
    let windows: unknown = [];
    if (pids[0]) {
      try {
        const client = await JdwpClient.open(adb, pids[0], { requestTimeoutMs: 5000 });
        try {
          windows = await client.listWindows();
        } finally {
          await client.close();
        }
      } catch (error) {
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
      for (const window of windows) console.log(`  ${window.index}: ${window.name}`);
    } else if (windows && !Array.isArray(windows)) {
      console.log(`windows: unavailable (${(windows as { error?: string }).error ?? "unknown"})`);
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
    if (target.pid === null) throw new AuiError("NO_PID", `No running process for ${target.packageName}.`);
    const client = await JdwpClient.open(adb, target.pid, { requestTimeoutMs: 10_000 });
    try {
      const windows = await client.listWindows();
      if (options.json) {
        printJson({ package: target.packageName, pid: target.pid, windows });
        return;
      }
      for (const window of windows) console.log(`${window.index}: ${window.name}`);
    } finally {
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
      if (options.json) printJson(file);
      return;
    }
    console.log(
      renderCapture(result, renderSource(source), {
        depth: options.depth,
        maxNodes: options.maxNodes,
        visibleOnly: options.visibleOnly,
        showCenter: true,
      }),
    );
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
    const matches: Array<Record<string, unknown>> = [];
    const trees = treesFor(result, parseSource(options.source), options.both);
    for (const [treeSource, roots] of trees) {
      const found = findNodes(roots, {
        query,
        by: options.by as FindBy,
        match: options.match as MatchMode,
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
    for (const match of limited) console.log(formatMatch(match));
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
      const hit = hitTest(roots, x, y);
      return {
        tree: treeSource,
        point: hit.point,
        selected: hit.candidates[options.index] ?? null,
        candidates: hit.candidates,
      };
    });
    if (options.json) {
      printJson(
        reports.map((report) => ({
          tree: report.tree,
          point: report.point,
          selected: report.selected ? nodeSummary(report.selected) : null,
          candidates: report.candidates.map((node) => nodeSummary(node)),
        })),
      );
      return;
    }
    for (const report of reports) {
      console.log(`── ${report.tree} ──`);
      if (!report.selected) {
        console.log(`(${x}, ${y}) no node found`);
        continue;
      }
      const node = report.selected;
      console.log(
        `(${x}, ${y}) -> ${node.ref} ${node.shortClassName}` +
          `${node.text ? ` "${node.text}"` : node.contentDescription ? ` "${node.contentDescription}"` : ""}`,
      );
      console.log(`  bounds [${node.bounds.left},${node.bounds.top}][${node.bounds.right},${node.bounds.bottom}] center (${Math.round(node.center.x)},${Math.round(node.center.y)})`);
      console.log(`  path ${nodePath(node)}`);
      if (report.candidates.length > 1) {
        console.log(`  ${report.candidates.length} candidates at this point:`);
        report.candidates.slice(0, 8).forEach((candidate, index) => {
          console.log(
            `    ${index === options.index ? "*" : " "} ${candidate.ref} ${candidate.shortClassName}` +
              ` [${candidate.bounds.width}x${candidate.bounds.height}]` +
              `${candidate.text ? ` "${candidate.text}"` : ""}`,
          );
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
      ? (options.rules.split(",").map((rule: string) => rule.trim()).filter(Boolean) as RuleName[])
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
    for (const warning of result.warnings) console.error(`warning: ${warning}`);
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
    throw new AuiError("BAD_INPUT", `No node with ref/id "${ref}" in the current UI.`);
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
    let annotated: string | null = null;
    if (options.annotate) {
      const result = await captureFor(command, options);
      const trees = treesFor(result, parseSource(options.source), false);
      const [treeSource, roots] = trees[0];
      const svgPath = options.out.replace(/\.png$/i, "") + ".annotated.svg";
      annotated = svgPath;
      await writeFile(
        svgPath,
        renderAnnotatedSvg(roots, {
          pngFileName: basename(options.out),
          width: screenshot.width,
          height: screenshot.height,
          uiScale: screenshot.scale,
          title: `${treeSource} ${screenshot.width}x${screenshot.height}`,
        }),
      );
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
      console.log(
        `saved ${options.out} (${screenshot.width}x${screenshot.height}, ` +
          `downscaled from ${screenshot.originalWidth}x${screenshot.originalHeight}; ` +
          `image→device ×${metadata.coordinateMapping.imageToDevice.x}/${metadata.coordinateMapping.imageToDevice.y})`,
      );
    } else {
      console.log(`saved ${options.out} (${screenshot.width}x${screenshot.height})`);
    }
    if (annotated) console.log(`saved ${annotated}`);
  });

program
  .command("view")
  .alias("open")
  .description("capture the current UI and open an interactive HTML viewer in the browser")
  .option("--source <mode>", "auto | view | semantics | compose | both", "auto")
  .option("--package <package>", "package name (defaults to foreground app)")
  .option("--pid <pid>", "process id")
  .option("--window <name-or-index>", "ViewRootImpl window to capture (view source)")
  .option("--out <file>", "HTML output path", ".aui/viewer.html")
  .option("--no-open", "write the HTML file without opening a browser")
  .option("--max-width <px>", "downscale the embedded screenshot to at most this width", parsePositiveInt, 1080)
  .option("--max-nodes <n>", "limit serialized nodes per tree", parsePositiveInt, 4000)
  .option("--props", "embed every ViewDebug property")
  .option("--rules <rules>", "comma-separated analysis rules (default: all)")
  .option("--no-issues", "skip layout/accessibility analysis")
  .option("--json", "output JSON")
  .action(async (options, command) => {
    const result = await captureFor(command, options);
    const adb = makeAdb(command);
    let screenshot: Screenshot | null = null;
    let screenshotError: string | null = null;
    try {
      screenshot = await takeScreenshot(adb, { maxWidth: options.maxWidth });
    } catch (error) {
      screenshotError = errorMessage(error);
    }
    const rules = options.rules
      ? (options.rules.split(",").map((rule: string) => rule.trim()).filter(Boolean) as RuleName[])
      : undefined;
    const analysis =
      options.issues === false ? null : analyzeCapture(result, { rules });
    const payload = viewerPayload(result, {
      screenshot,
      analysis,
      maxNodes: options.maxNodes,
      includeProperties: Boolean(options.props),
    });
    const html = renderViewerHtmlFromPayload(payload);
    const outPath = resolve(options.out);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, html, "utf8");

    const openResult =
      options.open === false ? { opened: false, error: "--no-open" } : await openInBrowser(outPath);
    const bytes = Buffer.byteLength(html, "utf8");
    const truncated = Object.keys(payload.trees).some(
      (source) => payload.trees[source as NodeSource]?.truncated === true,
    );
    const screenshotMeta = screenshot
      ? {
          width: screenshot.width,
          height: screenshot.height,
          originalWidth: screenshot.originalWidth,
          originalHeight: screenshot.originalHeight,
          scale: screenshot.scale,
        }
      : null;

    if (!options.json && !isInsideAui(outPath)) {
      console.error("warning: the viewer contains device/screen data; do not commit it.");
    }
    if (options.json) {
      printJson({
        path: outPath,
        opened: openResult.opened,
        ...(openResult.browser ? { browser: openResult.browser } : {}),
        ...(openResult.error ? { openError: openResult.error } : {}),
        bytes,
        uiKind: result.uiKind,
        sources: result.sources,
        truncated,
        trees: viewerTreeSummary(payload),
        screenshot: screenshotMeta,
        ...(screenshotError ? { screenshotError } : {}),
      });
      return;
    }

    const state = openResult.opened
      ? "opened in browser"
      : `not opened: ${openResult.error ?? "unknown"}`;
    console.log(`viewer ${outPath} (${state})`);
    console.log(
      `  ${bytes} bytes · uiKind ${result.uiKind} · nodes ${viewerTreeCounts(payload)}` +
        `${truncated ? " · truncated" : ""}`,
    );
    if (screenshot) {
      console.log(
        `  screenshot ${screenshot.width}x${screenshot.height} ` +
          `(from ${screenshot.originalWidth}x${screenshot.originalHeight})`,
      );
    } else {
      console.log(`  screenshot unavailable${screenshotError ? `: ${screenshotError}` : ""}`);
    }
    if (payload.meta.limits.budgetExceeded) {
      console.error("warning: embedded JSON exceeded the 8 MB budget; the payload was reduced.");
    }
  });

program
  .command("diff <before> <after>")
  .description("diff two dump JSON files")
  .option("--source <source>", "view | semantics | compose (defaults to each dump's primary source)")
  .option("--tolerance <px>", "bounds tolerance in pixels", parseNonNegativeInt, 1)
  .option("--json", "output JSON")
  .action(async (beforePath, afterPath, options) => {
    const [before, after] = await Promise.all([loadDump(beforePath), loadDump(afterPath)]);
    const source = options.source ? (options.source as NodeSource) : undefined;
    const chosen = chooseDiffSource(before, after, source);
    const result = diffSnapshots(
      snapshotRoots(before, chosen),
      snapshotRoots(after, chosen),
      { source: chosen, boundsTolerance: options.tolerance },
    );
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
    let point: { x: number; y: number } | null = null;
    let node: UiNode | null = null;
    const imageOptions = [
      options.imageX,
      options.imageY,
      options.imageWidth,
      options.imageHeight,
    ];
    if (imageOptions.some((value) => value !== undefined)) {
      if (imageOptions.some((value) => value === undefined)) {
        throw new AuiError(
          "BAD_INPUT",
          "Image-coordinate tap needs --image-x, --image-y, --image-width, and --image-height.",
        );
      }
      const screen = await adb.screenInfo();
      if (!screen.width || !screen.height) {
        throw new AuiError("BAD_INPUT", "Could not determine the device screen size for image-coordinate mapping.");
      }
      point = imageToDevicePoint(
        parseImageCoordinate(options.imageX, "image-x"),
        parseImageCoordinate(options.imageY, "image-y"),
        parseNonNegativeInt(options.imageWidth),
        parseNonNegativeInt(options.imageHeight),
        screen.width,
        screen.height,
      );
      console.log(
        `image (${options.imageX}, ${options.imageY}) in ${options.imageWidth}x${options.imageHeight} ` +
          `-> device (${point.x}, ${point.y}) on ${screen.width}x${screen.height}`,
      );
    } else if (xArg !== undefined || yArg !== undefined) {
      if (xArg === undefined || yArg === undefined) {
        throw new AuiError("BAD_INPUT", "tap needs both x and y, or a selector (--text/--id/--ref).");
      }
      point = { x: parseCoordinate(xArg, "x"), y: parseCoordinate(yArg, "y") };
    } else {
      const result = await captureFor(command, {
        ...options,
        source:
          options.ref && (!options.source || options.source === "auto") ? "both" : options.source,
      });
      const trees = treesFor(
        result,
        parseSource(options.source),
        options.ref !== undefined && (!options.source || options.source === "auto"),
      );
      const [treeSource, roots] = trees[0];
      const query = options.ref || options.text || options.id;
      if (!query) {
        throw new AuiError("BAD_INPUT", "tap needs coordinates or --text/--id/--ref.");
      }
      const by: FindBy = options.ref ? "ref" : options.id ? "id" : options.text ? (options.by as FindBy) : (options.by as FindBy);
      const matches = findNodes(roots, {
        query,
        by,
        match: options.match as MatchMode,
        visibleOnly: true,
      });
      node = matches[options.index]?.node ?? null;
      if (!node) {
        throw new AuiError("BAD_INPUT", `No visible ${treeSource} node matches "${query}" (--by ${by}).`);
      }
      point = node.center;
    }
    await adb.inputTap(point.x, point.y);
    console.log(`tapped (${Math.round(point.x)}, ${Math.round(point.y)})`);
    if (node) console.log(`node ${node.ref} ${nodePath(node)}`);
  });

program
  .command("swipe <x1> <y1> <x2> <y2>")
  .description("swipe between two screen coordinates")
  .option("--duration <ms>", "swipe duration", parsePositiveInt, 300)
  .action(async (x1, y1, x2, y2, options, command) => {
    const adb = makeAdb(command);
    await adb.inputSwipe(
      parseCoordinate(x1, "x1"),
      parseCoordinate(y1, "y1"),
      parseCoordinate(x2, "x2"),
      parseCoordinate(y2, "y2"),
      options.duration,
    );
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
    // The bracket in `[a]ui-compose` keeps the pattern from matching this very
    // shell, whose own command line contains the path. A literal path would make
    // pkill kill its own shell, so the shell dies before it can report success.
    await adb
      .shell("pkill -f '[a]ui-compose/daemon.config' 2>/dev/null", {
        timeoutMs: 10_000,
        allowFailure: true,
      })
      .catch(() => undefined);
    await adb.shell("rm -rf /data/local/tmp/aui-compose", { timeoutMs: 15_000, allowFailure: true });
    const foreground = await adb.foregroundApp();
    const packageName = options.package || foreground.packageName;
    if (packageName) {
      await adb
        .shell(
          `run-as ${packageName} sh -c 'cd code_cache && rm -f aui-view-inspector.jar aui-compose-inspector-*.jar libjvmtiagent_*.so perfa.jar transport'`,
          { timeoutMs: 20_000, allowFailure: true },
        )
        .catch(() => undefined);
      console.log(`cleaned Compose inspector artifacts for ${packageName}`);
    } else {
      console.log("cleaned Compose inspector daemon artifacts");
    }
  });

program
  .command("mcp")
  .description("start an MCP server (stdio) exposing Android UI inspection tools")
  .option("--print-config", "print an MCP client config snippet and exit")
  .addOption(
    new Option("--client <id>", "client the printed config is shaped for").choices([
      ...MCP_CLIENT_IDS,
    ]),
  )
  .option("--register-view-attributes", "set the debug_view_attributes global setting (restarts the app)")
  .action(async (options, command) => {
    const globals = globalOptions(command);
    if (options.printConfig) {
      const serverPath = fileURLToPath(new URL("./mcp.js", import.meta.url));
      const args = [
        serverPath,
        ...(globals.serial ? ["--serial", globals.serial] : []),
        ...(globals.adb ? ["--adb", globals.adb] : []),
        ...(globals.timeout !== 30_000 ? ["--timeout", String(globals.timeout)] : []),
        ...(globals.studio ? ["--studio", globals.studio] : []),
        ...(globals.java ? ["--java", globals.java] : []),
        ...(globals.composeVersion ? ["--compose-version", globals.composeVersion] : []),
      ];
      const requested: string = options.client ?? "claude";
      if (!isMcpClient(requested)) {
        throw new AuiError(
          "BAD_INPUT",
          `unknown client "${requested}"`,
          `supported clients: ${MCP_CLIENT_IDS.join(", ")}`,
        );
      }
      const config = mcpClientConfig(requested, "node", args);
      process.stdout.write(config.content);
      // stdout stays a paste-ready snippet; the destination goes to stderr.
      console.error(`# ${config.client}: merge into ${config.target} (${config.format})`);
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

function makeAdb(command: Command): Adb {
  const globals = globalOptions(command);
  return new Adb({ adbPath: globals.adb, serial: globals.serial, timeoutMs: globals.timeout });
}

function globalOptions(command: Command): GlobalOptions {
  const merged = command.optsWithGlobals() as Record<string, unknown>;
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

async function captureFor(command: Command, options: CaptureCommandOptions): Promise<CaptureResult> {
  const globals = globalOptions(command);
  const adb = makeAdb(command);
  const captureOptions: CaptureOptions = {
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
    onProgress: globals.verbose || options.verbose ? (message) => console.error(`[android-ui] ${message}`) : undefined,
  };
  try {
    return await capture(captureOptions);
  } catch (error) {
    if (globals.fallbackScreenshot !== false) {
      try {
        const shot = await takeScreenshot(adb, { maxWidth: 720 });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const path = join(process.cwd(), `aui-fallback-${stamp}.png`);
        await saveScreenshot(shot, path);
        const metadata = screenshotMetadata(shot);
        const code = error instanceof AuiError ? error.code : "VIEW_DUMP_FAILED";
        const hint = error instanceof AuiError ? error.hint : undefined;
        throw new AuiError(
          code,
          `${errorMessage(error)}
Fallback screenshot: ${path} ` +
            `(${shot.width}x${shot.height} from ${shot.originalWidth}x${shot.originalHeight}; ` +
            `image→device ×${metadata.coordinateMapping.imageToDevice.x}/${metadata.coordinateMapping.imageToDevice.y})`,
          hint,
        );
      } catch (fallbackError) {
        if (fallbackError instanceof AuiError && fallbackError.message.includes("Fallback screenshot:")) {
          throw fallbackError;
        }
      }
    }
    throw error;
  }
}

function parseSource(value?: string): SourceMode | undefined {
  if (value === undefined || value === "auto") return "auto";
  if (value === "view" || value === "semantics" || value === "compose" || value === "both") return value;
  throw new AuiError("BAD_INPUT", `Invalid --source "${value}" (expected auto, view, semantics, compose, or both).`);
}

async function resolvePackage(adb: Adb, packageOption?: string, pidOption?: string) {
  const foreground = await adb.foregroundApp();
  const packageName = packageOption || foreground.packageName;
  if (!packageName) throw new AuiError("BAD_INPUT", "No package specified and no foreground app detected.");
  const pid = pidOption ? parsePositiveInt(pidOption) : (await adb.packagePids(packageName))[0] ?? null;
  return { packageName, pid };
}

function formatMatch(match: Record<string, unknown>): string {
  const bounds = match.bounds as { left: number; top: number; right: number; bottom: number };
  const center = match.center as { x: number; y: number };
  const text = (match.text as string | null) || (match.contentDescription as string | null);
  return (
    `${match.ref as string} [${match.tree as string}] ${match.className as string}` +
    `${text ? ` "${text}"` : ""}` +
    `${match.resourceId ? ` ${match.resourceId as string}` : ""}` +
    ` [${bounds.left},${bounds.top}][${bounds.right},${bounds.bottom}] center=(${center.x},${center.y})` +
    `${match.clickable ? " click" : ""}` +
    `\n    ${match.fullPath as string}`
  );
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function isInsideAui(path: string): boolean {
  const root = dirname(defaultViewerPath());
  return path === root || path.startsWith(`${root}/`) || path.startsWith(`${root}\\`);
}

function viewerTreeSummary(
  payload: ViewerPayload,
): Record<string, { nodes: number; total: number; truncated: boolean }> {
  const summary: Record<string, { nodes: number; total: number; truncated: boolean }> = {};
  for (const [source, tree] of Object.entries(payload.trees)) {
    if (!tree) continue;
    summary[source] = { nodes: tree.nodeCount, total: tree.totalNodes, truncated: tree.truncated };
  }
  return summary;
}

function viewerTreeCounts(payload: ViewerPayload): string {
  const parts: string[] = [];
  for (const [source, tree] of Object.entries(payload.trees)) {
    if (!tree) continue;
    parts.push(`${source} ${tree.nodeCount}${tree.truncated ? `/${tree.totalNodes}` : ""}`);
  }
  return parts.length > 0 ? parts.join(", ") : "none";
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseImageCoordinate(value: string | number, name: string): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new AuiError("BAD_INPUT", `Invalid ${name} coordinate: ${value}`);
  }
  return parsed;
}

function parseCoordinate(value: string | number, name: string): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new AuiError("BAD_INPUT", `Invalid ${name} coordinate: ${value}`);
  }
  return parsed;
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Expected a positive integer, got "${value}"`);
  return parsed;
}

function parseScale(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    throw new Error(`Expected a scale between 0 and 1, got "${value}"`);
  }
  return parsed;
}

function parseNonNegativeInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Expected a non-negative integer, got "${value}"`);
  return parsed;
}
