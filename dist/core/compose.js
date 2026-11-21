import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { unzipSync } from "fflate";
import { DliError, errorMessage } from "./errors.js";
import { assignRefs } from "./viewdump.js";
const execFileAsync = promisify(execFile);
const DEFAULT_COMPOSE_VERSION = "1.8.3";
export async function captureComposeTree(options) {
    const started = Date.now();
    const progress = options.onProgress ?? (() => undefined);
    const adb = options.adb;
    const studio = await locateAndroidStudio(options.studioPath);
    progress(`Android Studio ${studio.root} (${studio.source})`);
    const java = await resolveJava(options.javaPath, studio);
    const helperJar = await resolveHelperJar(studio, java, progress);
    const composeVersion = options.composeVersion || process.env.DLI_COMPOSE_VERSION || DEFAULT_COMPOSE_VERSION;
    const composeJar = await resolveComposeInspectorJar({
        explicitPath: options.composeInspectorJar || process.env.DLI_COMPOSE_INSPECTOR_JAR,
        version: composeVersion,
        progress,
    });
    progress(`compose inspector ${composeVersion}: ${composeJar}`);
    const abi = await resolveAbi(adb);
    const transport = join(studio.resources, "transport", abi, "transport");
    const agentLib = join(studio.resources, "transport", "native", "agent", abi, "libjvmtiagent.so");
    const perfa = join(studio.resources, "perfa.jar");
    const viewInspector = join(studio.resources, "app-inspection", "layoutinspector-view-inspection.jar");
    for (const file of [transport, agentLib, perfa, viewInspector]) {
        await ensureFile(file, "The local Android Studio installation is missing an inspector artifact");
    }
    const id = randomBytes(4).toString("hex");
    // Keep the daemon and staged artifacts between invocations. The JVMTI agent is
    // resident in the app process and connects to this daemon; recreating the daemon
    // (or using a new socket per run) would orphan the resident agent.
    const staging = "/data/local/tmp/dli-compose";
    const socketName = "DliTransport";
    const agentLibName = `libjvmtiagent_${abi}.so`;
    const viewJarName = "dli-view-inspector.jar";
    const composeJarName = `dli-compose-inspector-${composeVersion.replace(/[^A-Za-z0-9._-]/g, "_")}.jar`;
    const composeDexPath = `/data/data/${options.packageName}/code_cache/${composeJarName}`;
    const viewDexPath = `/data/data/${options.packageName}/code_cache/${viewJarName}`;
    const localTemp = join(tmpdir(), `dli-compose-${id}`);
    let forwardPort = null;
    const warnings = [];
    try {
        await mkdir(localTemp, { recursive: true });
        await writeFile(join(localTemp, "daemon.config"), buildDaemonConfig(socketName));
        await writeFile(join(localTemp, "agent.config"), buildAgentConfig(socketName));
        await adb.shell(`mkdir -p ${staging}`);
        await adb.push(transport, `${staging}/transport`);
        await adb.push(agentLib, `${staging}/${agentLibName}`);
        await adb.push(perfa, `${staging}/perfa.jar`);
        await adb.push(viewInspector, `${staging}/${viewJarName}`);
        await adb.push(composeJar, `${staging}/${composeJarName}`);
        await adb.push(join(localTemp, "daemon.config"), `${staging}/daemon.config`);
        await adb.push(join(localTemp, "agent.config"), `${staging}/agent.config`);
        await adb.shell(`chmod 755 ${staging}/transport ${staging}/${agentLibName}`);
        progress(`staged artifacts in ${staging}`);
        // The JVMTI class loader only accepts read-only dex jars from the app's data directory.
        await adb.shell(`run-as ${options.packageName} sh -c 'mkdir -p code_cache && rm -f code_cache/${viewJarName} code_cache/${composeJarName} && cp ${staging}/${viewJarName} code_cache/${viewJarName} && cp ${staging}/${composeJarName} code_cache/${composeJarName} && chmod 444 code_cache/${viewJarName} code_cache/${composeJarName}'`, { timeoutMs: 60_000 });
        const sockets = await adb.shell("cat /proc/net/unix", { timeoutMs: 10_000, allowFailure: true });
        if (!sockets.includes(`@${socketName}`)) {
            const child = adb.spawnShellDetached(`cd ${staging} && exec ./transport --config_file ${staging}/daemon.config > transport.log 2>&1`);
            child.unref();
            await waitForAbstractSocket(adb, socketName, 8000);
            progress(`transport daemon started`);
        }
        else {
            progress(`reusing transport daemon`);
        }
        forwardPort = await adb.forwardAbstract(socketName);
        progress(`transport daemon ready on tcp:${forwardPort}`);
        const streamId = await computeStreamId(adb, options.deviceSerial);
        progress(`transport stream id ${streamId}`);
        const classpath = [...studioJars(studio), helperJar].join(delimiter);
        const args = [
            "-cp",
            classpath,
            "dli.ComposeInspectorHelper",
            "--port",
            String(forwardPort),
            "--stream-id",
            String(streamId),
            "--pid",
            String(options.pid),
            "--package",
            options.packageName,
            "--view-dex",
            viewDexPath,
            "--compose-dex",
            composeDexPath,
            "--agent-lib",
            agentLibName,
            "--agent-config",
            `${staging}/agent.config`,
            "--dispose",
            "true",
        ];
        let stdout = "";
        let stderr = "";
        try {
            const result = await execFileAsync(java, args, {
                timeout: options.timeoutMs ?? 120_000,
                maxBuffer: 256 * 1024 * 1024,
                windowsHide: true,
            });
            stdout = result.stdout;
            stderr = result.stderr;
        }
        catch (error) {
            const err = error;
            stdout = err.stdout ?? "";
            stderr = err.stderr ?? "";
            if (err.code === "ENOENT") {
                throw new DliError("COMPOSE_FAILED", `Could not run Java (${java}).`, "Install a JDK or set DLI_JAVA. Android Studio's bundled JBR can also be used.");
            }
        }
        if (stderr) {
            for (const line of stderr.split("\n")) {
                const trimmed = line.trim();
                if (trimmed)
                    progress(trimmed);
            }
        }
        const jsonText = extractJson(stdout);
        if (!jsonText) {
            throw new DliError("COMPOSE_FAILED", "The Compose inspector helper did not return JSON.", stderr.slice(-2000) || "Run with -v to see helper logs.");
        }
        const output = JSON.parse(jsonText);
        if (!output.ok) {
            throw new DliError("COMPOSE_FAILED", output.error || "Compose inspector failed.", composeFailureHint(output.error || "", composeVersion));
        }
        if (output.warnings)
            warnings.push(...output.warnings);
        const roots = buildComposeRoots(output.roots ?? [], options.packageName);
        assignRefs(roots, "c");
        progress(`captured ${countNodes(roots)} Compose nodes`);
        return {
            rootViewId: output.rootViewId ?? 0,
            roots,
            captureMs: Date.now() - started,
            warnings,
        };
    }
    finally {
        if (forwardPort !== null) {
            await adb.removeForward(forwardPort);
        }
        // The transport daemon and staged jars intentionally survive this invocation so the
        // resident JVMTI agent keeps working across CLI/MCP calls.
        await rm(localTemp, { recursive: true, force: true }).catch(() => undefined);
    }
}
/**
 * Resolves an Android Studio installation.
 *
 * Order:
 *   1. --studio / DLI_ANDROID_STUDIO / ANDROID_STUDIO_PATH
 *   2. the running studio64/studio process (the install the developer is actually
 *      using; also catches custom and Toolbox installs)
 *   3. standard install locations
 *
 * Process detection is cached for one hour. On Windows it costs roughly
 * 1.5-2s because PowerShell must start; the cache keeps that out of repeated
 * MCP/session calls.
 */
export async function locateAndroidStudio(explicit) {
    const configured = [
        { root: explicit ?? "", source: "explicit" },
        { root: process.env.DLI_ANDROID_STUDIO ?? "", source: "env" },
        { root: process.env.ANDROID_STUDIO_PATH ?? "", source: "env" },
    ].filter((entry) => entry.root.length > 0);
    const seen = new Set();
    for (const entry of configured) {
        if (seen.has(entry.root))
            continue;
        seen.add(entry.root);
        const studio = await validateStudioRoot(entry.root);
        if (studio)
            return { ...studio, source: entry.source };
    }
    for (const root of await detectRunningStudioRoots()) {
        if (seen.has(root))
            continue;
        seen.add(root);
        const studio = await validateStudioRoot(root);
        if (studio)
            return { ...studio, source: "process" };
    }
    for (const root of defaultStudioCandidates()) {
        if (!root || seen.has(root))
            continue;
        seen.add(root);
        const studio = await validateStudioRoot(root);
        if (studio)
            return { ...studio, source: "default" };
    }
    throw new DliError("COMPOSE_FAILED", "Android Studio was not found.", "Install Android Studio, start it once, or set DLI_ANDROID_STUDIO to its installation directory.");
}
async function validateStudioRoot(root) {
    const resources = join(root, "plugins", "android", "resources");
    const lib = join(root, "plugins", "android", "lib");
    try {
        await access(join(lib, "studio-proto.jar"));
        await access(join(lib, "transport_java_proto.jar"));
        await access(join(lib, "perfetto-protos.jar"));
        await access(join(lib, "studio-grpc.jar"));
        await access(join(lib, "layout_inspector_view_java_proto.jar"));
        await access(join(lib, "layout_inspector_compose_java_proto.jar"));
        await access(join(root, "lib", "intellij.libraries.guava.jar"));
        await access(join(resources, "transport"));
        await access(join(resources, "app-inspection", "layoutinspector-view-inspection.jar"));
    }
    catch {
        return null;
    }
    const exe = process.platform === "win32" ? ".exe" : "";
    const jbrJava = await firstExisting([
        join(root, "jbr", "bin", `java${exe}`),
        join(root, "jbr", "Contents", "Home", "bin", "java"),
        join(root, "Contents", "jbr", "Contents", "Home", "bin", "java"),
    ]);
    const javac = await firstExisting([
        join(root, "jbr", "bin", `javac${exe}`),
        join(root, "jbr", "Contents", "Home", "bin", "javac"),
        join(root, "Contents", "jbr", "Contents", "Home", "bin", "javac"),
        process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin", `javac${exe}`) : "",
    ]);
    const jarTool = await firstExisting([
        join(root, "jbr", "bin", `jar${exe}`),
        join(root, "jbr", "Contents", "Home", "bin", "jar"),
        join(root, "Contents", "jbr", "Contents", "Home", "bin", "jar"),
        process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin", `jar${exe}`) : "",
    ]);
    let version = null;
    let buildNumber = null;
    try {
        const productInfo = JSON.parse(await readFile(join(root, "product-info.json"), "utf8"));
        version = productInfo.version ?? null;
        buildNumber = productInfo.buildNumber ?? null;
    }
    catch {
        try {
            version = (await readFile(join(root, "build.txt"), "utf8")).trim() || null;
        }
        catch {
            // no version metadata
        }
    }
    return { root, resources, lib, java: jbrJava, version, buildNumber, javac, jarTool };
}
let runningStudioCache = null;
const RUNNING_STUDIO_CACHE_MS = 60 * 60_000;
/** Finds Studio installations from running IDE processes (custom paths, Toolbox, ...). */
export function detectRunningStudioRoots() {
    const now = Date.now();
    if (!runningStudioCache || now - runningStudioCache.at > RUNNING_STUDIO_CACHE_MS) {
        runningStudioCache = { at: now, value: detectRunningStudioRootsUncached() };
    }
    return runningStudioCache.value;
}
async function detectRunningStudioRootsUncached() {
    try {
        if (process.platform === "win32") {
            const { stdout } = await execFileAsync("powershell.exe", [
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Get-Process studio64,studio -ErrorAction SilentlyContinue | ForEach-Object { $_.Path }; exit 0",
            ], { timeout: 3000, windowsHide: true, maxBuffer: 1024 * 1024 });
            return uniqueRoots(stdout
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => /^[A-Za-z]:[\\/]/.test(line))
                .map((exe) => dirname(dirname(exe))));
        }
        if (process.platform === "darwin") {
            const { stdout } = await execFileAsync("ps", ["-axo", "args="], {
                timeout: 3000,
                maxBuffer: 1024 * 1024,
            });
            const roots = [];
            for (const line of stdout.split(/\r?\n/)) {
                const index = line.indexOf("Android Studio.app/Contents/MacOS/");
                if (index >= 0)
                    roots.push(`${line.slice(0, index)}Android Studio.app/Contents`);
            }
            return uniqueRoots(roots);
        }
        const { stdout } = await execFileAsync("ps", ["-axo", "args="], {
            timeout: 3000,
            maxBuffer: 1024 * 1024,
        });
        const roots = [];
        for (const line of stdout.split(/\r?\n/)) {
            const match = line.match(/([^\s"']+\/bin\/studio(?:\.sh)?)(?:\s|$)/);
            if (match)
                roots.push(dirname(dirname(match[1])));
        }
        return uniqueRoots(roots);
    }
    catch {
        return [];
    }
}
function uniqueRoots(roots) {
    return [...new Set(roots)];
}
function defaultStudioCandidates() {
    const home = homedir();
    if (process.platform === "win32") {
        return [
            process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs", "Android Studio") : "",
            "C:/Program Files/Android/Android Studio",
            "D:/Program Files/Android/Android Studio",
            "D:/Android/Android Studio",
            "C:/Program Files/JetBrains/Android Studio",
        ];
    }
    if (process.platform === "darwin") {
        return ["/Applications/Android Studio.app/Contents", join(home, "Applications", "Android Studio.app", "Contents")];
    }
    return ["/opt/android-studio", join(home, "android-studio"), join(home, ".local", "share", "JetBrains", "Toolbox", "apps", "AndroidStudio")];
}
async function resolveJava(explicit, studio) {
    const candidates = [
        explicit,
        process.env.DLI_JAVA,
        process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java") : undefined,
        studio.java ?? undefined,
        process.platform === "win32" ? "java.exe" : "java",
    ].filter((value) => Boolean(value));
    for (const candidate of candidates) {
        if (candidate.includes("/") || candidate.includes("\\")) {
            try {
                await access(candidate);
                return candidate;
            }
            catch {
                continue;
            }
        }
        else {
            return candidate;
        }
    }
    throw new DliError("COMPOSE_FAILED", "No Java runtime found for the Compose inspector helper.", "Set DLI_JAVA or install a JDK.");
}
const PACKAGED_HELPER_JAR = fileURLToPath(new URL("../../helper/dli-compose-helper.jar", import.meta.url));
const HELPER_SOURCE = fileURLToPath(new URL("../../helper/src/dli/ComposeInspectorHelper.java", import.meta.url));
function studioJars(studio) {
    return [
        join(studio.lib, "studio-proto.jar"),
        join(studio.lib, "transport_java_proto.jar"),
        join(studio.lib, "perfetto-protos.jar"),
        join(studio.lib, "studio-grpc.jar"),
        join(studio.lib, "layout_inspector_view_java_proto.jar"),
        join(studio.lib, "layout_inspector_compose_java_proto.jar"),
        join(studio.root, "lib", "intellij.libraries.guava.jar"),
    ];
}
/**
 * Returns a helper jar compiled against the selected Studio installation.
 *
 * Android Studio relocates its protobuf/gRPC classes and evolves the inspector
 * protos, so a jar compiled against one Studio version is not guaranteed to run
 * with another. We compile the helper lazily with the Studio's own javac, cache
 * it per build/source/compiler, and fall back to the packaged jar when no
 * compiler is available.
 */
async function resolveHelperJar(studio, java, progress) {
    const explicit = process.env.DLI_COMPOSE_HELPER_JAR;
    if (explicit) {
        await ensureFile(explicit, "The configured Compose helper jar does not exist");
        return explicit;
    }
    const exe = process.platform === "win32" ? ".exe" : "";
    const javaBin = java.includes("/") || java.includes("\\") ? dirname(java) : null;
    const siblingJavac = javaBin
        ? await firstExisting([join(javaBin, `javac${exe}`), join(javaBin, "javac")])
        : null;
    const siblingJar = javaBin ? await firstExisting([join(javaBin, `jar${exe}`), join(javaBin, "jar")]) : null;
    // Prefer a compiler from the same JDK that will run the helper, so the class
    // file version always matches. Fall back to Studio's JBR compiler.
    const javac = siblingJavac ?? studio.javac;
    const jarTool = siblingJar ?? studio.jarTool;
    if (!javac || !jarTool) {
        progress("no matching javac/jar; using packaged Compose helper");
        await ensureFile(PACKAGED_HELPER_JAR, "The packaged Compose helper is missing");
        return PACKAGED_HELPER_JAR;
    }
    try {
        let sourceHash = "";
        try {
            sourceHash = createHash("sha256").update(await readFile(HELPER_SOURCE)).digest("hex").slice(0, 12);
        }
        catch {
            await ensureFile(PACKAGED_HELPER_JAR, "The packaged Compose helper is missing");
            return PACKAGED_HELPER_JAR;
        }
        let compilerVersion = "unknown";
        try {
            const versionResult = await execFileAsync(javac, ["-version"], {
                timeout: 5000,
                windowsHide: true,
                maxBuffer: 1024 * 1024,
            });
            compilerVersion = `${versionResult.stdout}${versionResult.stderr}`.trim().split(/\r?\n/)[0] ?? "unknown";
        }
        catch {
            // Keep "unknown"; the compiler may still work.
        }
        const buildId = studio.buildNumber || studio.version || studio.root;
        const key = createHash("sha256")
            .update(`${buildId}|${sourceHash}|${compilerVersion}`)
            .digest("hex")
            .slice(0, 16);
        const cacheDir = join(homedir(), ".cache", "layout-inspector-android", "helper", key);
        const jarPath = join(cacheDir, "dli-compose-helper.jar");
        try {
            await access(jarPath);
            return jarPath;
        }
        catch {
            // compile below
        }
        await mkdir(cacheDir, { recursive: true });
        const classesDir = join(cacheDir, `classes-${process.pid}`);
        const tempJar = join(cacheDir, `helper-${process.pid}.jar`);
        await rm(classesDir, { recursive: true, force: true });
        await mkdir(classesDir, { recursive: true });
        progress(`compiling Compose helper for Android Studio ${buildId}`);
        await execFileAsync(javac, ["-cp", studioJars(studio).join(delimiter), "-d", classesDir, HELPER_SOURCE], { timeout: 60_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
        await execFileAsync(jarTool, ["cf", tempJar, "-C", classesDir, "."], {
            timeout: 30_000,
            windowsHide: true,
            maxBuffer: 8 * 1024 * 1024,
        });
        await rm(jarPath, { force: true });
        await rename(tempJar, jarPath);
        await rm(classesDir, { recursive: true, force: true });
        progress(`Compose helper cached at ${jarPath}`);
        return jarPath;
    }
    catch (error) {
        progress(`helper compilation failed (${errorMessage(error)}); using packaged helper`);
        await ensureFile(PACKAGED_HELPER_JAR, "The packaged Compose helper is missing");
        return PACKAGED_HELPER_JAR;
    }
}
async function resolveComposeInspectorJar(options) {
    if (options.explicitPath) {
        await ensureFile(options.explicitPath, "The configured Compose inspector jar does not exist");
        return options.explicitPath;
    }
    const cacheDir = join(homedir(), ".cache", "layout-inspector-android");
    const cachePath = join(cacheDir, `compose-inspector-${options.version}.jar`);
    try {
        const stat = await readFile(cachePath);
        if (stat.length > 1000)
            return cachePath;
    }
    catch {
        // download below
    }
    await mkdir(cacheDir, { recursive: true });
    const artifact = composeArtifactId(options.version);
    const urls = [
        `https://dl.google.com/dl/android/maven2/androidx/compose/ui/${artifact}/${options.version}/${artifact}-${options.version}.aar`,
        `https://dl.google.com/dl/android/maven2/androidx/compose/ui/ui/${options.version}/ui-${options.version}.aar`,
    ];
    let lastError = null;
    for (const url of urls) {
        try {
            options.progress(`downloading ${url}`);
            const response = await fetch(url);
            if (!response.ok)
                throw new Error(`HTTP ${response.status}`);
            const buffer = new Uint8Array(await response.arrayBuffer());
            const files = unzipSync(buffer);
            const key = Object.keys(files).find((name) => name.endsWith("inspector.jar"));
            if (!key)
                throw new Error("inspector.jar was not found in the AAR");
            await writeFile(cachePath, files[key]);
            options.progress(`cached ${cachePath}`);
            return cachePath;
        }
        catch (error) {
            lastError = error;
        }
    }
    throw new DliError("COMPOSE_FAILED", `Could not obtain the Compose inspector jar for version ${options.version}: ${errorMessage(lastError)}`, "Set DLI_COMPOSE_INSPECTOR_JAR to a local inspector.jar, or DLI_COMPOSE_VERSION to the app's Compose version.");
}
function composeArtifactId(version) {
    const [majorText, minorText] = version.split(".");
    const major = Number.parseInt(majorText, 10);
    const minor = Number.parseInt(minorText, 10);
    if (!Number.isFinite(major) || !Number.isFinite(minor))
        return "ui-android";
    // Compose 1.5.0-beta01 is the first release published as ui-android. Older
    // releases only exist under "ui"; the caller also tries both URLs.
    return major < 1 || (major === 1 && minor < 5) ? "ui" : "ui-android";
}
async function resolveAbi(adb) {
    const abi = (await adb.shell("getprop ro.product.cpu.abi", { timeoutMs: 10_000 })).trim();
    const supported = new Set(["arm64-v8a", "armeabi-v7a", "x86", "x86_64"]);
    if (!supported.has(abi)) {
        throw new DliError("COMPOSE_FAILED", `Unsupported device ABI: ${abi || "unknown"}`);
    }
    return abi;
}
async function computeStreamId(adb, serial) {
    const bootId = (await adb.shell("cat /proc/sys/kernel/random/boot_id", { timeoutMs: 10_000 })).trim();
    const digest = createHash("sha256").update(bootId, "utf8").update(serial, "utf8").digest();
    return digest.readBigInt64BE(0).toString();
}
async function waitForAbstractSocket(adb, socketName, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const sockets = await adb.shell("cat /proc/net/unix", { timeoutMs: 10_000, allowFailure: true });
        if (sockets.includes(`@${socketName}`))
            return;
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    const log = await adb
        .shell("cat /data/local/tmp/*/transport.log 2>/dev/null | tail -20", { timeoutMs: 10_000, allowFailure: true })
        .catch(() => "");
    throw new DliError("COMPOSE_FAILED", `Transport daemon did not start (${socketName}).`, log.trim() || "Check the device log.");
}
function buildDaemonConfig(socketName) {
    const common = Buffer.concat([
        encodeVarintField(1, 1), // CommonConfig.SocketType.ABSTRACT_SOCKET
        encodeStringField(2, "127.0.0.1:12389"),
        encodeStringField(3, socketName),
    ]);
    const layoutInspector = Buffer.concat([
        encodeVarintField(1, 1), // autoconnect_enabled
    ]);
    return Buffer.concat([encodeMessageField(1, common), encodeMessageField(3, layoutInspector)]);
}
function buildAgentConfig(socketName) {
    const common = Buffer.concat([
        encodeVarintField(1, 1),
        encodeStringField(2, "127.0.0.1:12389"),
        encodeStringField(3, socketName),
    ]);
    return encodeMessageField(1, common);
}
function encodeVarint(value) {
    let remaining = BigInt(value);
    const bytes = [];
    do {
        let byte = Number(remaining & 0x7fn);
        remaining >>= 7n;
        if (remaining > 0n)
            byte |= 0x80;
        bytes.push(byte);
    } while (remaining > 0n);
    return Buffer.from(bytes);
}
function encodeVarintField(field, value) {
    return Buffer.concat([encodeVarint((field << 3) | 0), encodeVarint(value)]);
}
function encodeStringField(field, value) {
    const data = Buffer.from(value, "utf8");
    return encodeMessageField(field, data);
}
function encodeMessageField(field, value) {
    return Buffer.concat([encodeVarint((field << 3) | 2), encodeVarint(value.length), value]);
}
export function buildComposeRoots(roots, packageName) {
    return roots.map((root) => buildComposeRoot(root, packageName));
}
function buildComposeRoot(root, packageName) {
    let counter = 0;
    const build = (node, parent, index, depth, path) => {
        const width = Math.max(0, node.bounds?.width ?? 0);
        const height = Math.max(0, node.bounds?.height ?? 0);
        const left = node.bounds?.left ?? 0;
        const top = node.bounds?.top ?? 0;
        const bounds = { left, top, right: left + width, bottom: top + height, width, height };
        const visible = width > 0 && height > 0;
        const compose = {
            composeId: node.id,
            name: node.name,
            fileName: node.fileName,
            lineNumber: node.lineNumber,
            offset: node.offset,
            anchorHash: node.anchorHash,
            recomposeCount: node.recomposeCount,
            recomposeSkips: node.recomposeSkips,
            flags: node.flags ?? [],
            ...(node.renderQuad ? { renderQuad: node.renderQuad } : {}),
        };
        const result = {
            id: path,
            ref: `c${counter++}`,
            source: "compose",
            index,
            depth,
            className: node.name || "Compose",
            shortClassName: node.name || "Compose",
            packageName,
            resourceId: null,
            text: node.text ?? null,
            contentDescription: node.contentDescription ?? null,
            bounds,
            visibleBounds: visible ? bounds : null,
            center: { x: left + width / 2, y: top + height / 2 },
            visible,
            enabled: true,
            clickable: false,
            longClickable: false,
            focusable: false,
            focused: false,
            scrollable: false,
            checkable: false,
            checked: false,
            selected: false,
            password: false,
            children: [],
            compose,
            parent,
        };
        result.children = (node.children ?? []).map((child, childIndex) => build(child, result, childIndex, depth + 1, `${path}.${childIndex}`));
        return result;
    };
    const rootNode = root.nodes[0];
    if (!rootNode) {
        return emptyRoot(root.viewId, packageName);
    }
    return build(rootNode, null, 0, 0, "0");
}
function emptyRoot(viewId, packageName) {
    return {
        id: "0",
        ref: "c0",
        source: "compose",
        index: 0,
        depth: 0,
        className: "ComposeRoot",
        shortClassName: "ComposeRoot",
        packageName,
        resourceId: null,
        text: null,
        contentDescription: null,
        bounds: { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 },
        visibleBounds: null,
        center: { x: 0, y: 0 },
        visible: false,
        enabled: true,
        clickable: false,
        longClickable: false,
        focusable: false,
        focused: false,
        scrollable: false,
        checkable: false,
        checked: false,
        selected: false,
        password: false,
        children: [],
        compose: {
            composeId: String(viewId),
            name: "ComposeRoot",
            fileName: "",
            lineNumber: 0,
            offset: 0,
            anchorHash: 0,
            recomposeCount: 0,
            recomposeSkips: 0,
            flags: [],
        },
    };
}
function countNodes(roots) {
    let count = 0;
    const walk = (node) => {
        count++;
        node.children.forEach(walk);
    };
    roots.forEach(walk);
    return count;
}
function extractJson(output) {
    const start = output.indexOf("{");
    const end = output.lastIndexOf("}");
    if (start < 0 || end <= start)
        return null;
    return output.slice(start, end + 1);
}
function composeFailureHint(message, version) {
    if (/UnsupportedClassVersionError|class file version/i.test(message)) {
        return "The Compose helper runs on a different JDK than it was compiled for. Use Android Studio's JBR (default) or ensure javac/jar are available next to the selected Java so dli can compile a matching helper.";
    }
    if (/VERSION|version|library|proguard/i.test(message)) {
        return `The app's Compose version may not be ${version}. Set DLI_COMPOSE_VERSION or DLI_COMPOSE_INSPECTOR_JAR.`;
    }
    if (/debuggable|Permission|run-as/i.test(message)) {
        return "Compose inspection requires a debuggable build (android:debuggable=true).";
    }
    if (/InspectorFactory|dex/i.test(message)) {
        return "The inspector jar was rejected by the app. Check the Compose version and that the app is a debug build.";
    }
    return "Use -v to see the transport/helper logs, and make sure the app is in the foreground.";
}
async function ensureFile(path, message) {
    try {
        await access(path);
    }
    catch {
        throw new DliError("COMPOSE_FAILED", `${message}: ${path}`);
    }
}
async function firstExisting(paths) {
    for (const path of paths) {
        try {
            await access(path);
            return path;
        }
        catch {
            continue;
        }
    }
    return null;
}
