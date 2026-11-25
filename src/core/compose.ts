import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { unzipSync } from "fflate";
import type { Adb } from "./adb.js";
import { AlmError, errorMessage } from "./errors.js";
import type { Bounds, ComposeDetails, ScreenInfo, UiNode } from "./model.js";
import { assignRefs, flattenNodes } from "./viewdump.js";

const execFileAsync = promisify(execFile);
const DEFAULT_COMPOSE_VERSION = "1.8.3";
const composeJarCache = new Map<string, string>();

export interface ComposeCaptureOptions {
  adb: Adb;
  deviceSerial: string;
  packageName: string;
  pid: number;
  /** Used for validation only; Compose bounds are already screen coordinates. */
  screen?: ScreenInfo;
  timeoutMs?: number;
  studioPath?: string;
  javaPath?: string;
  composeVersion?: string;
  composeInspectorJar?: string;
  onProgress?: (message: string) => void;
}

export interface ComposeCaptureResult {
  rootViewId: number;
  roots: UiNode[];
  captureMs: number;
  warnings: string[];
}

interface StudioPaths {
  root: string;
  resources: string;
  lib: string;
  java: string | null;
  version: string | null;
  buildNumber: string | null;
  javac: string | null;
  jarTool: string | null;
}

interface HelperNode {
  id: string;
  name: string;
  fileName: string;
  lineNumber: number;
  offset: number;
  anchorHash: number;
  recomposeCount: number;
  recomposeSkips: number;
  flags: string[];
  text?: string;
  contentDescription?: string;
  bounds?: { left: number; top: number; width: number; height: number };
  renderQuad?: number[];
  depth?: number;
  children: HelperNode[];
}

export interface HelperRoot {
  viewId: number;
  nodes: HelperNode[];
}

interface HelperOutput {
  ok: boolean;
  error?: string;
  rootViewId?: number;
  unchanged?: boolean;
  warnings?: string[];
  roots?: HelperRoot[];
}

export async function captureComposeTree(options: ComposeCaptureOptions): Promise<ComposeCaptureResult> {
  const started = Date.now();
  const progress = options.onProgress ?? (() => undefined);
  const adb = options.adb;
  const warnings: string[] = [];
  const warn = (message: string): void => {
    warnings.push(message);
    progress(message);
  };
  const studio = await locateAndroidStudio(options.studioPath);
  progress(`Android Studio ${studio.root} (${studio.source})`);
  const java = await resolveJava(options.javaPath, studio, warn);
  const helperJar = await resolveHelperJar(studio, java, progress);
  const composeVersion = options.composeVersion || process.env.ALM_COMPOSE_VERSION || DEFAULT_COMPOSE_VERSION;
  const composeJar = await resolveComposeInspectorJar({
    explicitPath: options.composeInspectorJar || process.env.ALM_COMPOSE_INSPECTOR_JAR,
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
  const staging = "/data/local/tmp/alm-compose";
  const socketName = "AlmTransport";
  const agentLibName = `libjvmtiagent_${abi}.so`;
  const viewJarName = "alm-view-inspector.jar";
  const composeJarName = `alm-compose-inspector-${composeVersion.replace(/[^A-Za-z0-9._-]/g, "_")}.jar`;
  const composeDexPath = `/data/data/${options.packageName}/code_cache/${composeJarName}`;
  const viewDexPath = `/data/data/${options.packageName}/code_cache/${viewJarName}`;
  const localTemp = join(tmpdir(), `alm-compose-${id}`);
  let forwardPort: number | null = null;

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
    await adb.shell(
      `run-as ${options.packageName} sh -c 'mkdir -p code_cache && rm -f code_cache/${viewJarName} code_cache/${composeJarName} && cp ${staging}/${viewJarName} code_cache/${viewJarName} && cp ${staging}/${composeJarName} code_cache/${composeJarName} && chmod 444 code_cache/${viewJarName} code_cache/${composeJarName}'`,
      { timeoutMs: 60_000 },
    );

    const sockets = await adb.shell("cat /proc/net/unix", { timeoutMs: 10_000, allowFailure: true });
    if (!sockets.includes(`@${socketName}`)) {
      const child = adb.spawnShellDetached(
        `cd ${staging} && exec ./transport --config_file ${staging}/daemon.config > transport.log 2>&1`,
      );
      child.unref();
      await waitForAbstractSocket(adb, socketName, 8000);
      progress(`transport daemon started`);
    } else {
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
      "alm.ComposeInspectorHelper",
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
    } catch (error) {
      const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
      stdout = err.stdout ?? "";
      stderr = err.stderr ?? "";
      if (err.code === "ENOENT") {
        throw new AlmError(
          "COMPOSE_FAILED",
          `Could not run Java (${java}).`,
          "Install a JDK or set ALM_JAVA. Android Studio's bundled JBR can also be used.",
        );
      }
    }
    if (stderr) {
      for (const line of stderr.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) progress(trimmed);
      }
    }
    const jsonText = extractJson(stdout);
    if (!jsonText) {
      throw new AlmError(
        "COMPOSE_FAILED",
        "The Compose inspector helper did not return JSON.",
        stderr.slice(-2000) || "Run with -v to see helper logs.",
      );
    }
    const output = JSON.parse(jsonText) as HelperOutput;
    if (!output.ok) {
      throw new AlmError(
        "COMPOSE_FAILED",
        output.error || "Compose inspector failed.",
        composeFailureHint(output.error || "", composeVersion),
      );
    }
    if (output.warnings) warnings.push(...output.warnings);
    const roots = buildComposeRoots(output.roots ?? [], options.packageName);
    progress(`captured ${flattenNodes(roots).length} Compose nodes`);
    return {
      rootViewId: output.rootViewId ?? 0,
      roots,
      captureMs: Date.now() - started,
      warnings,
    };
  } finally {
    if (forwardPort !== null) {
      await adb.removeForward(forwardPort);
    }
    // The transport daemon and staged jars intentionally survive this invocation so the
    // resident JVMTI agent keeps working across CLI/MCP calls.
    await rm(localTemp, { recursive: true, force: true }).catch(() => undefined);
  }
}

export type StudioSource = "explicit" | "env" | "default" | "process";

export interface StudioLocation extends StudioPaths {
  source: StudioSource;
}

/**
 * Resolves an Android Studio installation.
 *
 * Order:
 *   1. --studio / ALM_ANDROID_STUDIO / ANDROID_STUDIO_PATH
 *   2. the running studio64/studio process (the install the developer is actually
 *      using; also catches custom and Toolbox installs)
 *   3. standard install locations
 *
 * Process detection is cached for one hour. On Windows it costs roughly
 * 1.5-2s because PowerShell must start; the cache keeps that out of repeated
 * MCP/session calls.
 */
export async function locateAndroidStudio(explicit?: string): Promise<StudioLocation> {
  const configured: Array<{ root: string; source: StudioSource }> = [
    { root: explicit ?? "", source: "explicit" },
    { root: process.env.ALM_ANDROID_STUDIO ?? "", source: "env" },
    { root: process.env.ANDROID_STUDIO_PATH ?? "", source: "env" },
  ].filter((entry) => entry.root.length > 0) as Array<{ root: string; source: StudioSource }>;

  const seen = new Set<string>();
  for (const entry of configured) {
    if (seen.has(entry.root)) continue;
    seen.add(entry.root);
    const studio = await validateStudioRoot(entry.root);
    if (studio) return { ...studio, source: entry.source };
  }
  for (const root of await detectRunningStudioRoots()) {
    if (seen.has(root)) continue;
    seen.add(root);
    const studio = await validateStudioRoot(root);
    if (studio) return { ...studio, source: "process" };
  }
  for (const root of defaultStudioCandidates()) {
    if (!root || seen.has(root)) continue;
    seen.add(root);
    const studio = await validateStudioRoot(root);
    if (studio) return { ...studio, source: "default" };
  }
  throw new AlmError(
    "COMPOSE_FAILED",
    "Android Studio was not found.",
    "Install Android Studio, start it once, or set ALM_ANDROID_STUDIO to its installation directory.",
  );
}

async function validateStudioRoot(root: string): Promise<StudioPaths | null> {
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
  } catch {
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
  let version: string | null = null;
  let buildNumber: string | null = null;
  try {
    const productInfo = JSON.parse(await readFile(join(root, "product-info.json"), "utf8")) as {
      version?: string;
      buildNumber?: string;
    };
    version = productInfo.version ?? null;
    buildNumber = productInfo.buildNumber ?? null;
  } catch {
    try {
      version = (await readFile(join(root, "build.txt"), "utf8")).trim() || null;
    } catch {
      // no version metadata
    }
  }
  return { root, resources, lib, java: jbrJava, version, buildNumber, javac, jarTool };
}

let runningStudioCache: { at: number; value: Promise<string[]> } | null = null;
const RUNNING_STUDIO_CACHE_MS = 60 * 60_000;

/** Finds Studio installations from running IDE processes (custom paths, Toolbox, ...). */
export function detectRunningStudioRoots(): Promise<string[]> {
  const now = Date.now();
  if (!runningStudioCache || now - runningStudioCache.at > RUNNING_STUDIO_CACHE_MS) {
    runningStudioCache = { at: now, value: detectRunningStudioRootsUncached() };
  }
  return runningStudioCache.value;
}

async function detectRunningStudioRootsUncached(): Promise<string[]> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-Process studio64,studio -ErrorAction SilentlyContinue | ForEach-Object { $_.Path }; exit 0",
        ],
        { timeout: 3000, windowsHide: true, maxBuffer: 1024 * 1024 },
      );
      return uniqueRoots(
        stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => /^[A-Za-z]:[\\/]/.test(line))
          .map((exe) => dirname(dirname(exe))),
      );
    }
    if (process.platform === "darwin") {
      const { stdout } = await execFileAsync("ps", ["-axo", "args="], {
        timeout: 3000,
        maxBuffer: 1024 * 1024,
      });
      const roots: string[] = [];
      for (const line of stdout.split(/\r?\n/)) {
        const index = line.indexOf("Android Studio.app/Contents/MacOS/");
        if (index >= 0) roots.push(`${line.slice(0, index)}Android Studio.app/Contents`);
      }
      return uniqueRoots(roots);
    }
    const { stdout } = await execFileAsync("ps", ["-axo", "args="], {
      timeout: 3000,
      maxBuffer: 1024 * 1024,
    });
    const roots: string[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      const match = line.match(/([^\s"']+\/bin\/studio(?:\.sh)?)(?:\s|$)/);
      if (match) roots.push(dirname(dirname(match[1])));
    }
    return uniqueRoots(roots);
  } catch {
    return [];
  }
}

function uniqueRoots(roots: string[]): string[] {
  return [...new Set(roots)];
}

function defaultStudioCandidates(): string[] {
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

/** Exported for tests; the search order is user-visible via `docs/data-sources.md`. */
export async function resolveJava(
  explicit: string | undefined,
  studio: { java?: string | null },
  warn: (message: string) => void = () => undefined,
): Promise<string> {
  const javaName = process.platform === "win32" ? "java.exe" : "java";
  // Only the two user-controlled entries are worth warning about; a missing
  // JAVA_HOME, Studio JBR, or PATH lookup is an expected part of the search order.
  for (const [label, path] of [
    ["--java", explicit],
    ["ALM_JAVA", process.env.ALM_JAVA],
  ] as const) {
    // A bare name such as `--java java` means "use PATH"; the OS resolves it.
    if (!path) continue;
    if (!isPathLike(path) || (await exists(path))) return path;
    warn(`Ignoring ${label}: ${path} does not exist. Falling back to the next Java in the search order.`);
  }
  const fallback = await firstExisting([
    process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin", javaName) : "",
    studio.java ?? "",
  ]);
  return fallback ?? javaName;
}

const PACKAGED_HELPER_JAR = fileURLToPath(new URL("../../helper/alm-compose-helper.jar", import.meta.url));
const HELPER_SOURCE = fileURLToPath(new URL("../../helper/src/alm/ComposeInspectorHelper.java", import.meta.url));

function studioJars(studio: StudioPaths): string[] {
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
async function resolveHelperJar(
  studio: StudioPaths,
  java: string,
  progress: (message: string) => void,
): Promise<string> {
  const explicit = process.env.ALM_COMPOSE_HELPER_JAR;
  if (explicit) {
    await ensureFile(explicit, "The configured Compose helper jar does not exist");
    return explicit;
  }
  const exe = process.platform === "win32" ? ".exe" : "";
  const javaBin = isPathLike(java) ? dirname(java) : null;
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
    } catch {
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
    } catch {
      // Keep "unknown"; the compiler may still work.
    }
    const buildId = studio.buildNumber || studio.version || studio.root;
    const key = createHash("sha256")
      .update(`${buildId}|${sourceHash}|${compilerVersion}`)
      .digest("hex")
      .slice(0, 16);
    const cacheDir = join(homedir(), ".cache", "android-layout", "helper", key);
    const jarPath = join(cacheDir, "alm-compose-helper.jar");
    try {
      await access(jarPath);
      return jarPath;
    } catch {
      // compile below
    }
    await mkdir(cacheDir, { recursive: true });
    const classesDir = join(cacheDir, `classes-${process.pid}`);
    const tempJar = join(cacheDir, `helper-${process.pid}.jar`);
    await rm(classesDir, { recursive: true, force: true });
    await mkdir(classesDir, { recursive: true });
    progress(`compiling Compose helper for Android Studio ${buildId}`);
    await execFileAsync(
      javac,
      ["-cp", studioJars(studio).join(delimiter), "-d", classesDir, HELPER_SOURCE],
      { timeout: 60_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    );
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
  } catch (error) {
    progress(`helper compilation failed (${errorMessage(error)}); using packaged helper`);
    await ensureFile(PACKAGED_HELPER_JAR, "The packaged Compose helper is missing");
    return PACKAGED_HELPER_JAR;
  }
}

async function resolveComposeInspectorJar(options: {
  explicitPath?: string;
  version: string;
  progress: (message: string) => void;
}): Promise<string> {
  if (options.explicitPath) {
    await ensureFile(options.explicitPath, "The configured Compose inspector jar does not exist");
    return options.explicitPath;
  }
  const cached = composeJarCache.get(options.version);
  if (cached) {
    await ensureFile(cached, "The cached Compose inspector jar is missing");
    return cached;
  }
  const cacheDir = join(homedir(), ".cache", "android-layout");
  const cachePath = join(cacheDir, `compose-inspector-${options.version}.jar`);
  try {
    const info = await stat(cachePath);
    if (info.size > 1000) {
      composeJarCache.set(options.version, cachePath);
      return cachePath;
    }
  } catch {
    // download below
  }
  await mkdir(cacheDir, { recursive: true });
  const artifact = composeArtifactId(options.version);
  const urls = [
    `https://dl.google.com/dl/android/maven2/androidx/compose/ui/${artifact}/${options.version}/${artifact}-${options.version}.aar`,
    `https://dl.google.com/dl/android/maven2/androidx/compose/ui/ui/${options.version}/ui-${options.version}.aar`,
  ];
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      options.progress(`downloading ${url}`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = new Uint8Array(await response.arrayBuffer());
      const files = unzipSync(buffer);
      const key = Object.keys(files).find((name) => name.endsWith("inspector.jar"));
      if (!key) throw new Error("inspector.jar was not found in the AAR");
      await writeFile(cachePath, files[key]);
      composeJarCache.set(options.version, cachePath);
      options.progress(`cached ${cachePath}`);
      return cachePath;
    } catch (error) {
      lastError = error;
    }
  }
  throw new AlmError(
    "COMPOSE_FAILED",
    `Could not obtain the Compose inspector jar for version ${options.version}: ${errorMessage(lastError)}`,
    "Set ALM_COMPOSE_INSPECTOR_JAR to a local inspector.jar, or ALM_COMPOSE_VERSION to the app's Compose version.",
  );
}

function composeArtifactId(version: string): string {
  const [majorText, minorText] = version.split(".");
  const major = Number.parseInt(majorText, 10);
  const minor = Number.parseInt(minorText, 10);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return "ui-android";
  // Compose 1.5.0-beta01 is the first release published as ui-android. Older
  // releases only exist under "ui"; the caller also tries both URLs.
  return major < 1 || (major === 1 && minor < 5) ? "ui" : "ui-android";
}

async function resolveAbi(adb: Adb): Promise<string> {
  const abi = (await adb.shell("getprop ro.product.cpu.abi", { timeoutMs: 10_000 })).trim();
  const supported = new Set(["arm64-v8a", "armeabi-v7a", "x86", "x86_64"]);
  if (!supported.has(abi)) {
    throw new AlmError("COMPOSE_FAILED", `Unsupported device ABI: ${abi || "unknown"}`);
  }
  return abi;
}

async function computeStreamId(adb: Adb, serial: string): Promise<string> {
  const bootId = (await adb.shell("cat /proc/sys/kernel/random/boot_id", { timeoutMs: 10_000 })).trim();
  const digest = createHash("sha256").update(bootId, "utf8").update(serial, "utf8").digest();
  return digest.readBigInt64BE(0).toString();
}

async function waitForAbstractSocket(adb: Adb, socketName: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sockets = await adb.shell("cat /proc/net/unix", { timeoutMs: 10_000, allowFailure: true });
    if (sockets.includes(`@${socketName}`)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const log = await adb
    .shell("cat /data/local/tmp/*/transport.log 2>/dev/null | tail -20", { timeoutMs: 10_000, allowFailure: true })
    .catch(() => "");
  throw new AlmError("COMPOSE_FAILED", `Transport daemon did not start (${socketName}).`, log.trim() || "Check the device log.");
}

function commonConfig(socketName: string): Buffer {
  return Buffer.concat([
    encodeVarintField(1, 1), // CommonConfig.SocketType.ABSTRACT_SOCKET
    encodeStringField(2, "127.0.0.1:12389"),
    encodeStringField(3, socketName),
  ]);
}

function buildDaemonConfig(socketName: string): Buffer {
  const layoutInspector = Buffer.concat([
    encodeVarintField(1, 1), // autoconnect_enabled
  ]);
  return Buffer.concat([encodeMessageField(1, commonConfig(socketName)), encodeMessageField(3, layoutInspector)]);
}

function buildAgentConfig(socketName: string): Buffer {
  return encodeMessageField(1, commonConfig(socketName));
}

function encodeVarint(value: number): Buffer {
  let remaining = BigInt(value);
  const bytes: number[] = [];
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining > 0n) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0n);
  return Buffer.from(bytes);
}

function encodeVarintField(field: number, value: number): Buffer {
  return Buffer.concat([encodeVarint((field << 3) | 0), encodeVarint(value)]);
}

function encodeStringField(field: number, value: string): Buffer {
  const data = Buffer.from(value, "utf8");
  return encodeMessageField(field, data);
}

function encodeMessageField(field: number, value: Buffer): Buffer {
  return Buffer.concat([encodeVarint((field << 3) | 2), encodeVarint(value.length), value]);
}

export function buildComposeRoots(roots: HelperRoot[], packageName: string): UiNode[] {
  const result = roots.map((root) => {
    const rootNode = root.nodes[0];
    return rootNode ? buildComposeNode(rootNode, packageName) : emptyRoot(root.viewId, packageName);
  });
  assignRefs(result, "c");
  return result;
}

function buildComposeNode(node: HelperNode, packageName: string): UiNode {
  const width = Math.max(0, node.bounds?.width ?? 0);
  const height = Math.max(0, node.bounds?.height ?? 0);
  const left = node.bounds?.left ?? 0;
  const top = node.bounds?.top ?? 0;
  const bounds: Bounds = { left, top, right: left + width, bottom: top + height, width, height };
  const visible = width > 0 && height > 0;
  const compose: ComposeDetails = {
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
  const result: UiNode = {
    // Derived fields are assigned once by assignRefs after the tree is built.
    id: "",
    ref: "",
    source: "compose",
    index: 0,
    depth: 0,
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
    parent: null,
  };
  result.children = (node.children ?? []).map((child) => buildComposeNode(child, packageName));
  return result;
}

function emptyRoot(viewId: number, packageName: string): UiNode {
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

function extractJson(output: string): string | null {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return output.slice(start, end + 1);
}

function composeFailureHint(message: string, version: string): string {
  if (/UnsupportedClassVersionError|class file version/i.test(message)) {
    return "The Compose helper runs on a different JDK than it was compiled for. Use Android Studio's JBR (default) or ensure javac/jar are available next to the selected Java so android-layout can compile a matching helper.";
  }
  if (/VERSION|version|library|proguard/i.test(message)) {
    return `The app's Compose version may not be ${version}. Set ALM_COMPOSE_VERSION or ALM_COMPOSE_INSPECTOR_JAR.`;
  }
  if (/debuggable|Permission|run-as/i.test(message)) {
    return "Compose inspection requires a debuggable build (android:debuggable=true).";
  }
  if (/InspectorFactory|dex/i.test(message)) {
    return "The inspector jar was rejected by the app. Check the Compose version and that the app is a debug build.";
  }
  return "Use -v to see the transport/helper logs, and make sure the app is in the foreground.";
}

async function ensureFile(path: string, message: string): Promise<void> {
  try {
    await access(path);
  } catch {
    throw new AlmError("COMPOSE_FAILED", `${message}: ${path}`);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isPathLike(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const path of paths) {
    if (path && (await exists(path))) return path;
  }
  return null;
}