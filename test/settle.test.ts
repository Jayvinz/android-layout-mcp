import { test } from "node:test";
import { strict as assert } from "node:assert";
import { waitForStableUi, type SettleOptions } from "../src/core/settle.js";
import { renderCapture } from "../src/core/render.js";
import { loadFixtureCapture } from "./fixtures.js";

/** A probe that returns the scripted values in order, repeating the last one. */
function scriptedProbe(values: Array<number | null>, counter = { calls: 0 }) {
  return {
    calls: counter,
    async frameCount(): Promise<number | null> {
      const value = values[Math.min(counter.calls, values.length - 1)];
      counter.calls++;
      return value;
    },
  };
}

/** Virtual clock: sleeping advances time instantly, so the tests do not wait. */
function virtualClock() {
  let time = 0;
  const options: SettleOptions = {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
  };
  return { options, elapsed: () => time };
}

test("settles after two quiet intervals", async () => {
  const probe = scriptedProbe([10, 10, 10]);
  const clock = virtualClock();
  const info = await waitForStableUi(probe, "com.example", {
    ...clock.options,
    intervalMs: 250,
    timeoutMs: 3000,
    stableIntervals: 2,
  });
  assert.equal(info.stable, true);
  assert.equal(info.reason, "settled");
  assert.equal(info.waitedMs, 500);
  assert.equal(info.framesPerInterval, 0);
  assert.equal(info.hint, undefined);
  assert.equal(info.samples.length, 3);
});

test("reports an animating UI on timeout with the last frame delta", async () => {
  let frames = 10;
  const probe = {
    async frameCount() {
      frames += 2;
      return frames;
    },
  };
  const clock = virtualClock();
  const info = await waitForStableUi(probe, "com.example", {
    ...clock.options,
    intervalMs: 250,
    timeoutMs: 1000,
  });
  assert.equal(info.stable, false);
  assert.equal(info.reason, "timeout");
  assert.equal(info.waitedMs, 1000);
  assert.equal(info.framesPerInterval, 2);
  assert.match(info.hint ?? "", /frames in the last 250ms/);
  assert.match(info.hint ?? "", /mid-animation/);
});

test("treats a missing frame counter as unknown, never as idle", async () => {
  const probe = scriptedProbe([null]);
  const clock = virtualClock();
  const info = await waitForStableUi(probe, "com.example", {
    ...clock.options,
    intervalMs: 250,
    timeoutMs: 500,
  });
  assert.equal(info.stable, null);
  assert.equal(info.reason, "unavailable");
  assert.equal(info.framesPerInterval, null);
  assert.match(info.hint ?? "", /gfxinfo/);
});

test("survives a transient null sample without declaring stability", async () => {
  const probe = scriptedProbe([10, null, 10, 10]);
  const clock = virtualClock();
  const info = await waitForStableUi(probe, "com.example", {
    ...clock.options,
    intervalMs: 250,
    timeoutMs: 3000,
    stableIntervals: 2,
  });
  assert.equal(info.stable, true);
  assert.equal(info.reason, "settled");
  assert.equal(info.waitedMs, 750);
  assert.ok(info.samples.some((sample) => sample.frames === null));
});

test("a throwing probe is treated like a missing counter", async () => {
  const probe = {
    async frameCount(): Promise<number | null> {
      throw new Error("adb: device offline");
    },
  };
  const clock = virtualClock();
  const info = await waitForStableUi(probe, "com.example", {
    ...clock.options,
    intervalMs: 100,
    timeoutMs: 300,
  });
  assert.equal(info.reason, "unavailable");
  assert.equal(info.stable, null);
});

test("the tree header shows the stability verdict", () => {
  const capture = loadFixtureCapture();
  const settled = renderCapture({ ...capture, stability: {
    stable: true,
    reason: "settled",
    waitedMs: 500,
    intervalMs: 250,
    samples: [{ atMs: 0, frames: 3 }, { atMs: 250, frames: 3 }, { atMs: 500, frames: 3 }],
    framesPerInterval: 0,
  } });
  assert.match(settled, /stable: yes \(settled in 500ms/);

  const unstable = renderCapture({ ...capture, stability: {
    stable: false,
    reason: "timeout",
    waitedMs: 3000,
    intervalMs: 250,
    samples: [],
    framesPerInterval: 12,
    hint: "still animating",
  } });
  assert.match(unstable, /stable: no — 12 frames in the last 250ms/);

  const unknown = renderCapture({ ...capture, stability: {
    stable: null,
    reason: "unavailable",
    waitedMs: 3000,
    intervalMs: 250,
    samples: [],
    framesPerInterval: null,
    hint: "no counter",
  } });
  assert.match(unknown, /stable: unknown \(no counter\)/);
});