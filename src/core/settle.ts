import type { StabilityInfo } from "./model.js";

/**
 * The single device call this module needs, so the probe can be faked in tests.
 * `Adb` satisfies it.
 */
export interface FrameProbe {
  frameCount(packageName: string): Promise<number | null>;
}

export interface SettleOptions {
  /** Give up waiting after this many milliseconds (default 3000). */
  timeoutMs?: number;
  /** Sampling interval (default 250 ms). */
  intervalMs?: number;
  /** Consecutive quiet intervals required to call the UI settled (default 2). */
  stableIntervals?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export const DEFAULT_SETTLE_TIMEOUT_MS = 3000;
export const DEFAULT_SETTLE_INTERVAL_MS = 250;
export const DEFAULT_STABLE_INTERVALS = 2;

/** Keeps the reported sample list small even when a caller asks for a long wait. */
const MAX_SAMPLES = 40;

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Waits until the app stops producing frames, and reports what it saw.
 *
 * `dumpsys gfxinfo` exposes a per-process frame counter, so two samples with no
 * difference mean the UI is not animating. That is a cheap approximation of
 * `UiAutomation.waitForIdle`: it cannot name the node that keeps invalidating,
 * but it does tell the caller whether a snapshot is trustworthy, which is what
 * an agent needs before reading bounds.
 *
 * A `null` sample means the counter was unavailable (process not running, ROM
 * without gfxinfo output); it never counts as quiet.
 */
export async function waitForStableUi(
  probe: FrameProbe,
  packageName: string,
  options: SettleOptions = {},
): Promise<StabilityInfo> {
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS);
  const intervalMs = Math.max(1, options.intervalMs ?? DEFAULT_SETTLE_INTERVAL_MS);
  const stableIntervals = Math.max(1, options.stableIntervals ?? DEFAULT_STABLE_INTERVALS);
  const sleep = options.sleep ?? delay;
  const now = options.now ?? (() => Date.now());

  const started = now();
  const samples: StabilityInfo["samples"] = [];
  const sample = async (): Promise<number | null> => {
    let frames: number | null = null;
    try {
      frames = await probe.frameCount(packageName);
    } catch {
      frames = null;
    }
    if (samples.length < MAX_SAMPLES) samples.push({ atMs: now() - started, frames });
    return frames;
  };

  let previous = await sample();
  let previousAt: number | null = samples.length > 0 ? samples[samples.length - 1].atMs : null;
  let streak = 0;
  let lastDelta: number | null = null;
  let measured = 0;
  let measuredIntervalMs: number | null = null;

  for (;;) {
    const remaining = timeoutMs - (now() - started);
    // Only full intervals count: a truncated window would let a shorter quiet
    // period than the caller asked for count as "settled".
    if (remaining < intervalMs) break;
    await sleep(intervalMs);
    const current = await sample();
    if (previous !== null && current !== null) {
      measured++;
      const at = now() - started;
      measuredIntervalMs = previousAt === null ? intervalMs : Math.max(1, at - previousAt);
      previousAt = at;
      lastDelta = current - previous;
      if (lastDelta === 0) {
        streak++;
        if (streak >= stableIntervals) {
          return {
            stable: true,
            reason: "settled",
            waitedMs: now() - started,
            intervalMs,
            samples,
            framesPerInterval: 0,
            ...(measuredIntervalMs === null ? {} : { measuredIntervalMs }),
          };
        }
      } else {
        streak = 0;
      }
      previous = current;
    }
  }

  const waitedMs = now() - started;
  if (measured === 0) {
    return {
      stable: null,
      reason: "unavailable",
      waitedMs,
      intervalMs,
      samples,
      framesPerInterval: null,
      hint: 'dumpsys gfxinfo reported no "Total frames rendered" for this package; capture stability is unknown.',
    };
  }
  return {
    stable: false,
    reason: "timeout",
    waitedMs,
    intervalMs,
    samples,
    framesPerInterval: lastDelta,
    ...(measuredIntervalMs === null ? {} : { measuredIntervalMs }),
    hint:
      `The UI produced ${lastDelta ?? "?"} frames in the last ${measuredIntervalMs ?? intervalMs}ms, so the capture may be ` +
      "mid-animation or mid-scroll. Re-capture after it settles, or treat bounds and text as a snapshot.",
  };
}