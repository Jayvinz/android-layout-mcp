import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import net from "node:net";
import type { Adb } from "../src/core/adb.js";
import { capture } from "../src/core/capture.js";
import { parseDumpsys } from "../src/core/dumpsys.js";
import { AlmError } from "../src/core/errors.js";
import { fragmentsFromDump, readFragments } from "../src/core/fragments.js";
import type { ScreenInfo } from "../src/core/model.js";
import { captureState, readWindows } from "../src/core/state.js";

const dumpsys = readFileSync(new URL("./fixtures/dumpsys-activity.txt", import.meta.url), "utf8");
const semanticsXml = readFileSync(new URL("./fixtures/semantics-studymixed.xml", import.meta.url), "utf8");

const SCREEN: ScreenInfo = {
  width: 1080,
  height: 2400,
  density: 2.75,
  densityDpi: 440,
  orientation: "portrait",
  rotation: 0,
};

const DEVICE = {
  serial: "fixture",
  state: "device",
  model: "Fixture",
  product: null,
  device: null,
  transportId: null,
  manufacturer: "Test",
  androidRelease: "13",
  sdk: 33,
};

interface StubOptions {
  packageName?: string | null;
  pids?: number[];
  shellOutput?: string;
  /** Per-command shell output, matched in order before `shellOutput`. */
  shellRoutes?: Array<[RegExp, string]>;
  /** Content of `adb exec-out cat`, i.e. the uiautomator dump file. */
  shellRawOutput?: string;
  /** Rejects the JDWP port forward, which is how a non-debuggable app fails. */
  jdwpFails?: boolean;
  /** Exact error thrown by the JDWP probe when `jdwpFails` is set. */
  jdwpError?: Error;
  /** Port the JDWP client should connect to (a fake server in tests). */
  jdwpPort?: number;
}

/** Minimal Adb stand-in: only the calls the helpers make are implemented. */
function stubAdb(options: StubOptions = {}) {
  const calls = {
    forwardPids: [] as number[],
    removedForwards: [] as number[],
    shells: [] as string[],
    shellRaws: [] as string[],
  };
  const adb = {
    async resolveDevice() {
      return DEVICE;
    },
    async screenInfo() {
      return SCREEN;
    },
    async foregroundApp() {
      const packageName =
        options.packageName === null ? null : options.packageName ?? "com.example.studymixed";
      return { packageName, activity: ".EntryActivity", raw: null };
    },
    async packagePids() {
      return options.pids ?? [];
    },
    async shell(command: string) {
      calls.shells.push(command);
      for (const [pattern, output] of options.shellRoutes ?? []) {
        if (pattern.test(command)) return output;
      }
      return options.shellOutput ?? "";
    },
    async shellRaw(command: string) {
      calls.shellRaws.push(command);
      return Buffer.from(options.shellRawOutput ?? "", "utf8");
    },
    async forwardJdwp(pid: number) {
      calls.forwardPids.push(pid);
      if (options.jdwpFails !== false) {
        throw options.jdwpError ?? new AlmError("JDWP_FAILED", "not debuggable");
      }
      return options.jdwpPort ?? 0;
    },
    async removeForward(port: number) {
      calls.removedForwards.push(port);
    },
  };
  return { adb: adb as unknown as Adb, calls };
}

test("captureState resolves device, screen, foreground package, pids, and empty windows", async () => {
  const { adb } = stubAdb({ pids: [] });
  const state = await captureState(adb);
  assert.equal(state.device.serial, "fixture");
  assert.equal(state.screen.width, 1080);
  assert.equal(state.foreground.packageName, "com.example.studymixed");
  assert.equal(state.package, "com.example.studymixed");
  assert.deepEqual(state.pids, []);
  assert.deepEqual(state.windows, [], "no process means no JDWP probe");
});

test("captureState prefers an explicit package and reports JDWP failures as { error }", async () => {
  const { adb, calls } = stubAdb({ pids: [5866], jdwpFails: true });
  const state = await captureState(adb, { packageName: "com.example.explicit" });
  assert.equal(state.package, "com.example.explicit");
  assert.deepEqual(state.pids, [5866]);
  assert.deepEqual(calls.forwardPids, [5866]);
  assert.ok(!Array.isArray(state.windows), "a failed probe is reported, not thrown");
  assert.match((state.windows as { error: string }).error, /not debuggable/);
});

test("captureState honours an explicit pid over the package's first process", async () => {
  const { adb, calls } = stubAdb({ pids: [5866], jdwpFails: true });
  const state = await captureState(adb, { pid: 777 });
  assert.deepEqual(calls.forwardPids, [777]);
  assert.deepEqual(state.pids, [5866]);
});

test("captureState falls back to the explicit pid when no package can be resolved", async () => {
  const { adb, calls } = stubAdb({ packageName: null, jdwpFails: true });
  const state = await captureState(adb, { pid: 4242 });
  assert.equal(state.package, null);
  assert.deepEqual(state.pids, [4242]);
  assert.deepEqual(calls.forwardPids, [4242]);
});

test("readFragments returns the unified field set and filters framework fragments by default", async () => {
  const { adb, calls } = stubAdb({ shellOutput: dumpsys });
  const report = await readFragments(adb);
  assert.equal(report.package, "com.example.studymixed");
  assert.deepEqual(calls.shells, ["dumpsys activity com.example.studymixed"]);
  assert.equal(report.activities.length, 1);
  assert.equal(report.activities[0].activity, "com.example.studymixed/.EntryActivity");
  assert.equal(report.activities[0].pid, 5866);
  // The fixture only contains the AndroidX ReportFragment bookkeeping entry.
  assert.deepEqual(report.fragments, []);
  assert.deepEqual(report.activities[0].fragments, []);
});

test("readFragments keeps framework fragments on request with the full shared shape", async () => {
  const { adb } = stubAdb({ shellOutput: dumpsys });
  const report = await readFragments(adb, { includeFramework: true });
  assert.equal(report.fragments.length, 1);
  // The fixture prints mFragmentId/mContainerId on one line; the parser reads
  // the first property of a line, so containerId stays null rather than guessed.
  assert.deepEqual(report.fragments[0], {
    className: "ReportFragment",
    shortClassName: "ReportFragment",
    tag: "androidx.lifecycle.LifecycleDispatcher.report_fragment_tag",
    state: 5,
    added: true,
    hidden: false,
    detached: false,
    containerId: null,
    activity: "com.example.studymixed/.EntryActivity",
  });
  // The fixture lists the same instance under "Active Fragments" and "Added
  // Fragments"; per-activity records keep both, the flattened list de-duplicates.
  assert.equal(report.activities[0].fragments.length, 2);
  assert.deepEqual(report.activities[0].fragments[0], report.fragments[0]);
});

test("readFragments requires a package to inspect", async () => {
  const { adb } = stubAdb({ packageName: null, shellOutput: dumpsys });
  await assert.rejects(readFragments(adb), (error: unknown) => {
    assert.ok(error instanceof AlmError);
    assert.equal(error.code, "BAD_INPUT");
    return true;
  });
});

/** UTF-16BE, the encoding the view-debug protocol uses for strings. */
function utf16be(text: string): Buffer {
  const buffer = Buffer.alloc(text.length * 2);
  for (let i = 0; i < text.length; i++) buffer.writeUInt16BE(text.charCodeAt(i), i * 2);
  return buffer;
}

function int32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

/**
 * A minimal JDWP/DDMS endpoint: it answers the handshake and the `VULW` window
 * list chunk, which is all `readWindows` asks for. A real device is needed for
 * anything more.
 */
async function fakeJdwpServer(names: string[]): Promise<{ port: number; close: () => Promise<void> }> {
  const server = net.createServer((socket) => {
    let rx = Buffer.alloc(0);
    let handshaken = false;
    socket.on("error", () => undefined);
    socket.on("data", (chunk) => {
      rx = Buffer.concat([rx, chunk]);
      if (!handshaken) {
        if (rx.length < 14) return;
        handshaken = true;
        rx = rx.subarray(14);
        socket.write("JDWP-Handshake", "ascii");
      }
      while (rx.length >= 11) {
        const length = rx.readUInt32BE(0);
        if (rx.length < length) return;
        const packet = rx.subarray(0, length);
        rx = rx.subarray(length);
        const id = packet.readUInt32BE(4);
        if (packet[9] !== 0xc7 || packet[10] !== 0x01) continue; // resume etc.
        const request = packet.subarray(11);
        const type = request.subarray(0, 4).toString("ascii");
        const list = Buffer.concat([
          int32(names.length),
          ...names.map((name) => Buffer.concat([int32(name.length), utf16be(name)])),
        ]);
        const reply = Buffer.concat([Buffer.from(type, "ascii"), int32(list.length), list]);
        const header = Buffer.alloc(11);
        header.writeUInt32BE(11 + reply.length, 0);
        header.writeUInt32BE(id, 4);
        header[8] = 0x80; // reply flag
        header[9] = 0xc7;
        header[10] = 0x01;
        socket.write(Buffer.concat([header, reply]));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

test("readWindows resolves the pid, lists windows, and closes the forward", async () => {
  const fake = await fakeJdwpServer([
    "com.example.studymixed/.EntryActivity",
    "com.example.studymixed/.DetailActivity",
  ]);
  try {
    const { adb, calls } = stubAdb({ pids: [5866], jdwpFails: false, jdwpPort: fake.port });
    const result = await readWindows(adb, { packageName: "com.example.studymixed", requestTimeoutMs: 4000 });
    assert.equal(result.pid, 5866);
    assert.equal(result.error, undefined);
    assert.ok(Array.isArray(result.windows));
    assert.deepEqual(
      result.windows.map((window) => window.name),
      ["com.example.studymixed/.EntryActivity", "com.example.studymixed/.DetailActivity"],
    );
    assert.equal(result.windows[0].packageName, "com.example.studymixed");
    assert.equal(result.windows[0].activity, ".EntryActivity");
    assert.deepEqual(calls.forwardPids, [5866]);
    assert.deepEqual(calls.removedForwards, [fake.port], "the JDWP forward must be removed");
  } finally {
    await fake.close();
  }
});

test("readWindows reports a JDWP failure as a sentinel instead of throwing", async () => {
  const { adb, calls } = stubAdb({ pids: [5866], jdwpFails: true });
  const result = await readWindows(adb, { packageName: "com.example.studymixed" });
  assert.equal(result.pid, 5866);
  assert.ok(!Array.isArray(result.windows), "a failed probe is reported, not thrown");
  assert.match((result.windows as { error: string }).error, /not debuggable/);
  assert.ok(result.error instanceof AlmError);
  assert.equal((result.error as AlmError).code, "JDWP_FAILED");
  assert.deepEqual(calls.forwardPids, [5866]);
});

test("readWindows hands the original error back so its code and hint survive", async () => {
  const timeout = new AlmError("TIMEOUT", "Timed out waiting for JDWP.", "Retry, or use --source semantics.");
  const { adb } = stubAdb({ pids: [5866], jdwpFails: true, jdwpError: timeout });
  const result = await readWindows(adb, { packageName: "com.example.studymixed" });
  assert.ok(!Array.isArray(result.windows));
  // The same instance, so a front end that rethrows it keeps TIMEOUT + the hint
  // instead of flattening everything into JDWP_FAILED.
  assert.equal(result.error, timeout);
  assert.equal((result.error as AlmError).code, "TIMEOUT");
  assert.equal((result.error as AlmError).hint, "Retry, or use --source semantics.");
  assert.match((result.windows as { error: string }).error, /Timed out waiting for JDWP/);
});

test("readWindows does not probe when no process can be resolved", async () => {
  const { adb, calls } = stubAdb({ pids: [] });
  const result = await readWindows(adb, { packageName: "com.example.studymixed" });
  assert.equal(result.pid, null);
  assert.deepEqual(result.windows, []);
  assert.equal(result.error, undefined);
  assert.deepEqual(calls.forwardPids, [], "no pid means no JDWP probe");
});

/**
 * Drives the shipped `capture(source=dumpsys)` path over a stub device: it must
 * project the parse it already did onto the shared fragment field set.
 */
async function captureDumpsysOnly(dumpsysText: string) {
  const { adb } = stubAdb({
    pids: [5866],
    shellRawOutput: semanticsXml,
    shellRoutes: [
      [/^uiautomator dump /, "UI hierchary dumped to: /data/local/tmp/alm-test.xml"],
      [/^dumpsys activity /, dumpsysText],
      [/^rm -f /, ""],
    ],
  });
  return capture({ adb, source: "dumpsys" });
}

test("dumpsys-only capture exposes a unified fragment set in CaptureResult", async () => {
  const result = await captureDumpsysOnly(dumpsys);
  assert.equal(result.source, "dumpsys");
  assert.deepEqual(result.sources, ["semantics", "dumpsys"]);
  assert.equal(result.uiKind, "unknown");
  assert.equal(result.dumpsys?.activity, "com.example.studymixed/.EntryActivity");
  assert.ok((result.dumpsys?.roots.length ?? 0) > 0);
  // The fixture only holds the AndroidX lifecycle bookkeeping fragment, so the
  // notable set is empty - but it is the projected set, not a literal.
  assert.deepEqual(result.dumpsys?.fragments, []);
});

test("dumpsys-only capture reports the full fragment field set", async () => {
  // Re-label the fixture's framework fragment so the notable filter keeps it;
  // the shipped parser then fills every field of the shared summary.
  const labelled = dumpsys
    .replaceAll("ReportFragment", "FeedListFragment")
    .replaceAll("androidx.lifecycle.LifecycleDispatcher.report_fragment_tag", "feed_list")
    .replace("mFragmentId=#0 mContainerId=#0 mTag=feed_list", "mContainerId=#11 mFragmentId=#7 mTag=feed_list");
  const result = await captureDumpsysOnly(labelled);
  assert.deepEqual(result.dumpsys?.fragments, [
    {
      className: "FeedListFragment",
      shortClassName: "FeedListFragment",
      tag: "feed_list",
      state: 5,
      added: true,
      hidden: false,
      detached: false,
      containerId: 11,
      activity: "com.example.studymixed/.EntryActivity",
    },
  ]);
});

test("fragmentsFromDump projects an existing parse without another dumpsys call", () => {
  const parsed = parseDumpsys(dumpsys, { packageName: "com.example.studymixed", screen: SCREEN });
  const projected = fragmentsFromDump(parsed, { includeFramework: true });
  const all = fragmentsFromDump(parsed);
  assert.equal(projected.fragments.length, 1);
  assert.equal(projected.fragments[0].state, 5);
  assert.deepEqual(all.fragments, []);
  assert.equal(projected.activities[0].activity, parsed.activities[0].activity);
});
