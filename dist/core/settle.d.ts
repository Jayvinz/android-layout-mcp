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
export declare const DEFAULT_SETTLE_TIMEOUT_MS = 3000;
export declare const DEFAULT_SETTLE_INTERVAL_MS = 250;
export declare const DEFAULT_STABLE_INTERVALS = 2;
export declare function delay(ms: number): Promise<void>;
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
export declare function waitForStableUi(probe: FrameProbe, packageName: string, options?: SettleOptions): Promise<StabilityInfo>;
