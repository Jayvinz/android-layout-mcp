#!/usr/bin/env node
/**
 * Rebuilds helper/alm-compose-helper.jar against the locally installed Android Studio jars.
 * Android Studio's transport/JVMTI artifacts and shaded protobuf/gRPC classes are used at
 * runtime; the helper itself only contains our bridge code.
 */
import { execFileSync } from "node:child_process";
import { accessSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const candidates = [
  process.env.ALM_ANDROID_STUDIO,
  process.env.ANDROID_STUDIO_PATH,
  process.platform === "win32" && process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "Programs", "Android Studio")
    : undefined,
  "C:/Program Files/Android/Android Studio",
  "D:/Program Files/Android/Android Studio",
  "D:/Android/Android Studio",
  "/Applications/Android Studio.app/Contents",
  "/opt/android-studio",
  join(homedir(), "android-studio"),
].filter(Boolean);

const studio = candidates.find((root) => {
  try {
    accessSync(join(root, "plugins/android/lib/studio-proto.jar"));
    accessSync(join(root, "plugins/android/lib/layout_inspector_compose_java_proto.jar"));
    return true;
  } catch {
    return false;
  }
});

if (!studio) {
  console.error("Android Studio not found. Set ALM_ANDROID_STUDIO.");
  process.exit(1);
}

const javaCandidates = [
  process.env.ALM_JAVAC,
  process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "javac.exe" : "javac") : undefined,
  join(studio, "jbr", "bin", process.platform === "win32" ? "javac.exe" : "javac"),
  join(studio, "jbr", "Contents", "Home", "bin", "javac"),
  "javac",
].filter(Boolean);
const javac = javaCandidates.find((candidate) => !candidate.includes("/") && !candidate.includes("\\") || existsSync(candidate));
const jarCandidates = [
  process.env.ALM_JAR,
  process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "jar.exe" : "jar") : undefined,
  join(studio, "jbr", "bin", process.platform === "win32" ? "jar.exe" : "jar"),
  join(studio, "jbr", "Contents", "Home", "bin", "jar"),
  "jar",
].filter(Boolean);
const jar = jarCandidates.find((candidate) => !candidate.includes("/") && !candidate.includes("\\") || existsSync(candidate));

const classpath = [
  join(studio, "plugins/android/lib/studio-proto.jar"),
  join(studio, "plugins/android/lib/transport_java_proto.jar"),
  join(studio, "plugins/android/lib/perfetto-protos.jar"),
  join(studio, "plugins/android/lib/studio-grpc.jar"),
  join(studio, "plugins/android/lib/layout_inspector_view_java_proto.jar"),
  join(studio, "plugins/android/lib/layout_inspector_compose_java_proto.jar"),
].join(delimiter);

const outDir = join("helper", "build", "classes");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
execFileSync(javac, ["-cp", classpath, "-d", outDir, join("helper", "src", "alm", "ComposeInspectorHelper.java")], {
  stdio: "inherit",
});
execFileSync(jar, ["cf", join("helper", "alm-compose-helper.jar"), "-C", outDir, "."], { stdio: "inherit" });
console.log(`built helper/alm-compose-helper.jar using ${studio}`);