import { captureComposeTree } from "./compose.js";
import { DliError, errorMessage } from "./errors.js";
import { JdwpClient } from "./jdwp.js";
import { parseSemanticsXml } from "./semantics.js";
import { flattenNodes, parseViewHierarchy } from "./viewdump.js";
const STRUCTURAL_CONTAINER_CLASSES = new Set([
    "com.android.internal.policy.DecorView",
    "android.widget.FrameLayout",
    "android.widget.LinearLayout",
    "android.widget.RelativeLayout",
    "android.widget.ScrollView",
    "androidx.constraintlayout.widget.ConstraintLayout",
    "androidx.coordinatorlayout.widget.CoordinatorLayout",
    "androidx.compose.ui.platform.ComposeView",
    "androidx.compose.ui.platform.AndroidComposeView",
    "androidx.compose.ui.platform.AndroidViewsHandler",
    "androidx.compose.material.ripple.RippleContainer",
    "androidx.compose.material.ripple.RippleHostView",
    "android.view.ViewStub",
    "android.view.View",
]);
const SYSTEM_IDS = /(^|:)\s*id\/(content|action_mode_bar_stub|decor_content_parent|action_bar.*|navigationBarBackground|statusBarBackground)$/;
const XML_LEAF_CLASS = /(TextView|Button|EditText|ImageView|ImageButton|RecyclerView|ScrollView|NestedScrollView|ViewPager|Toolbar|CardView|WebView|Switch|CheckBox|RadioButton|SeekBar|ProgressBar|Spinner|ListView|GridView|SurfaceView|TextureView|VideoView)/;
/**
 * Classifies the current screen from the ViewDebug tree:
 *  - xml:     no ComposeView at all
 *  - compose: ComposeView present and only framework/Compose wrappers
 *  - mixed:   ComposeView present plus XML content or AndroidView interop children
 */
export function classifyUi(viewRoots) {
    const nodes = flattenNodes(viewRoots);
    if (nodes.length === 0)
        return "unknown";
    const hasCompose = nodes.some((node) => /ComposeView|AndroidComposeView/.test(node.className));
    if (!hasCompose)
        return "xml";
    const hasXmlContent = nodes.some((node) => {
        if (/ComposeView|AndroidComposeView/.test(node.className))
            return false;
        if (node.className.startsWith("androidx.compose."))
            return false;
        if (node.className === "com.android.internal.policy.DecorView")
            return false;
        if (node.text || node.contentDescription || node.clickable)
            return true;
        if (node.resourceId && !SYSTEM_IDS.test(node.resourceId))
            return true;
        if (XML_LEAF_CLASS.test(node.className))
            return true;
        // Pure containers are usually just scaffolding around a ComposeView.
        if (STRUCTURAL_CONTAINER_CLASSES.has(node.className))
            return false;
        // A custom/unknown View is treated as XML content.
        return true;
    });
    return hasXmlContent ? "mixed" : "compose";
}
export async function capture(options) {
    const sourceMode = options.source ?? "auto";
    const adb = options.adb;
    const device = await adb.resolveDevice();
    const progress = options.onProgress ?? (() => undefined);
    const warnings = [];
    progress(`device ${device.serial}${device.model ? ` (${device.model})` : ""}`);
    const [screen, foreground] = await Promise.all([adb.screenInfo(), adb.foregroundApp()]);
    const packageName = options.packageName || foreground.packageName;
    if (!packageName) {
        throw new DliError("BAD_INPUT", "Could not determine the foreground app package.", "Pass --package <package> or make sure an app is in the foreground.");
    }
    progress(`foreground ${packageName}${foreground.activity ? `/${foreground.activity}` : ""}`);
    const target = {
        serial: device.serial,
        packageName,
        pid: options.pid ?? null,
        activity: foreground.activity,
        debuggable: null,
        windows: [],
    };
    if (target.pid === null) {
        const pids = await adb.packagePids(packageName);
        target.pid = pids[0] ?? null;
    }
    progress(target.pid ? `pid ${target.pid}` : "no running process found for the package");
    const wantView = sourceMode !== "semantics" && sourceMode !== "compose";
    const wantSemantics = sourceMode !== "view" && sourceMode !== "compose";
    const wantCompose = sourceMode === "compose";
    let viewResult = null;
    let semanticsResult = null;
    let composeResult = null;
    if (wantView) {
        if (target.pid === null) {
            warnings.push(`Package ${packageName} is not running; view hierarchy capture was skipped.`);
        }
        else {
            try {
                viewResult = await captureViewHierarchy(adb, target, screen, options);
                target.debuggable = true;
                progress(`captured view hierarchy (${viewResult.roots.length} root, ${flattenNodes(viewResult.roots).length} nodes)`);
            }
            catch (error) {
                const message = errorMessage(error);
                warnings.push(`View hierarchy capture failed: ${message}`);
                if (sourceMode === "view")
                    throw error;
                progress(`view hierarchy unavailable, falling back to semantics (${message})`);
            }
        }
    }
    if (wantSemantics) {
        try {
            semanticsResult = await captureSemantics(adb, packageName, options);
            progress(`captured semantics tree (${flattenNodes(semanticsResult.roots).length} nodes)`);
        }
        catch (error) {
            const message = errorMessage(error);
            warnings.push(`Semantics capture failed: ${message}`);
            if (sourceMode === "semantics" || !viewResult) {
                throw error;
            }
        }
    }
    if (wantCompose) {
        if (target.pid === null) {
            throw new DliError("NO_PID", `Package ${packageName} is not running; Compose inspection needs a live process.`);
        }
        const result = await captureComposeTree({
            adb,
            deviceSerial: device.serial,
            packageName,
            pid: target.pid,
            screen,
            timeoutMs: options.requestTimeoutMs,
            studioPath: options.studioPath,
            javaPath: options.javaPath,
            composeVersion: options.composeVersion,
            composeInspectorJar: options.composeInspectorJar,
            onProgress: progress,
        });
        composeResult = {
            rootViewId: result.rootViewId,
            roots: result.roots,
            captureMs: result.captureMs,
        };
        warnings.push(...result.warnings);
        target.debuggable = true;
        progress(`captured Compose tree (${flattenNodes(result.roots).length} nodes)`);
    }
    if (!viewResult && !semanticsResult && !composeResult) {
        throw new DliError("VIEW_DUMP_FAILED", "Could not capture the UI from the device.", warnings.join(" | "));
    }
    const uiKind = composeResult && !viewResult
        ? "compose"
        : viewResult
            ? classifyUi(viewResult.roots)
            : "unknown";
    let source;
    if (sourceMode === "auto") {
        source = chooseAutoSource(viewResult, semanticsResult, uiKind);
    }
    else if (sourceMode === "both") {
        source = viewResult ? "view" : "semantics";
    }
    else {
        source = sourceMode;
    }
    const sources = [];
    if (viewResult)
        sources.push("view");
    if (semanticsResult)
        sources.push("semantics");
    if (composeResult)
        sources.push("compose");
    return {
        device,
        target,
        screen,
        source,
        sources,
        uiKind,
        ...(viewResult ? { view: viewResult } : {}),
        ...(semanticsResult ? { semantics: semanticsResult } : {}),
        ...(composeResult ? { compose: composeResult } : {}),
        warnings,
    };
}
async function captureViewHierarchy(adb, target, screen, options) {
    if (target.pid === null) {
        throw new DliError("NO_PID", "The app does not have a running process.");
    }
    const started = Date.now();
    const client = await JdwpClient.open(adb, target.pid, {
        requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
    });
    try {
        const windows = await client.listWindows();
        target.windows = windows;
        if (windows.length === 0) {
            throw new DliError("VIEW_DUMP_FAILED", "The app reported no windows.");
        }
        const candidates = chooseWindows(windows, options.window, target.packageName);
        let lastError = null;
        for (const window of candidates.slice(0, 4)) {
            try {
                const bytes = await client.dumpViewHierarchy(window.name);
                const roots = parseViewHierarchy(bytes, {
                    screen,
                    packageName: target.packageName,
                    includeProperties: options.includeProperties,
                });
                if (roots.length === 0) {
                    lastError = new DliError("VIEW_DUMP_FAILED", "The view hierarchy was empty.");
                    continue;
                }
                target.selectedWindow = window.name;
                return { window: window.name, roots, captureMs: Date.now() - started };
            }
            catch (error) {
                lastError = error;
            }
        }
        throw lastError instanceof Error
            ? lastError
            : new DliError("VIEW_DUMP_FAILED", "Could not capture any window.");
    }
    finally {
        await client.close();
    }
}
function chooseWindows(windows, requested, packageName) {
    if (requested) {
        const index = Number.parseInt(requested, 10);
        if (/^\d+$/.test(requested) && Number.isFinite(index)) {
            const match = windows[index];
            if (!match) {
                throw new DliError("BAD_INPUT", `Window index ${index} does not exist (0-${windows.length - 1}).`, `Windows: ${windows.map((w, i) => `${i}: ${w.name}`).join(", ")}`);
            }
            return [match];
        }
        const matches = windows.filter((window) => window.name.includes(requested));
        if (matches.length === 0) {
            throw new DliError("BAD_INPUT", `No window matches "${requested}".`, `Windows: ${windows.map((w, i) => `${i}: ${w.name}`).join(", ")}`);
        }
        return matches;
    }
    const samePackage = packageName
        ? windows.filter((window) => window.packageName === packageName)
        : [];
    const rest = windows.filter((window) => !samePackage.includes(window));
    return [...samePackage, ...rest];
}
async function captureSemantics(adb, packageName, options) {
    const started = Date.now();
    const remotePath = `/data/local/tmp/dli-${Date.now()}-${Math.floor(Math.random() * 1e6)}.xml`;
    try {
        const dump = await adb.shell(`uiautomator dump ${remotePath}`, {
            timeoutMs: options.requestTimeoutMs ?? 30_000,
            allowFailure: true,
        });
        if (/ERROR|could not|failed/i.test(dump) && !dump.includes("dumped to")) {
            throw new DliError("SEMANTICS_FAILED", `uiautomator dump failed: ${dump.trim()}`);
        }
        const xml = await adb.shellRaw(`cat ${remotePath}`, { timeoutMs: 20_000 });
        const text = xml.toString("utf8");
        if (!text.includes("<hierarchy")) {
            throw new DliError("SEMANTICS_FAILED", "uiautomator did not return a hierarchy.");
        }
        const parsed = parseSemanticsXml(text, packageName);
        return { rotation: parsed.rotation, roots: parsed.roots, captureMs: Date.now() - started };
    }
    finally {
        try {
            await adb.shell(`rm -f ${remotePath}`, { timeoutMs: 10_000, allowFailure: true });
        }
        catch {
            // ignore
        }
    }
}
function chooseAutoSource(viewResult, semanticsResult, uiKind) {
    if (!viewResult)
        return "semantics";
    if (!semanticsResult)
        return "view";
    if (uiKind === "mixed")
        return "view";
    // Compose renders into a single AndroidComposeView; the ViewDebug dump stops
    // there, while the semantics tree contains the actual text and controls.
    return uiKind === "compose" ? "semantics" : "view";
}
/**
 * The single source-to-trees policy shared by the CLI and MCP server.
 * `auto` follows the captured primary source, but mixed screens expose both
 * trees so callers can search/locate XML and Compose content.
 */
export function treesFor(result, source, both) {
    const trees = [];
    const mode = both ? "both" : source ?? "auto";
    if (mode === "both") {
        if (result.view)
            trees.push(["view", result.view.roots]);
        if (result.semantics)
            trees.push(["semantics", result.semantics.roots]);
    }
    else if (mode === "compose") {
        if (result.compose)
            trees.push(["compose", result.compose.roots]);
    }
    else if (mode === "view") {
        if (result.view)
            trees.push(["view", result.view.roots]);
    }
    else if (mode === "semantics") {
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
    if (trees.length === 0) {
        throw new DliError("VIEW_DUMP_FAILED", `No ${mode} tree available.${result.warnings.length ? ` ${result.warnings.join(" | ")}` : ""}`, "Try source=semantics (works on non-debuggable apps) or source=auto.");
    }
    return trees;
}
