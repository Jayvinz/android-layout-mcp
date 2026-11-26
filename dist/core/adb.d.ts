import { type ChildProcess } from "node:child_process";
import type { DeviceInfo, ForegroundApp, ScreenInfo } from "./model.js";
export interface AdbOptions {
    adbPath?: string;
    serial?: string;
    timeoutMs?: number;
}
interface RunOptions {
    timeoutMs?: number;
    encoding?: "utf8" | "buffer";
    allowFailure?: boolean;
}
export declare class Adb {
    readonly adbPath: string;
    readonly serial?: string;
    readonly defaultTimeoutMs: number;
    constructor(options?: AdbOptions);
    withSerial(serial?: string): Adb;
    private args;
    run(extra: string[], options?: RunOptions): Promise<Buffer | string>;
    out(extra: string[], options?: RunOptions): Promise<string>;
    raw(extra: string[], options?: RunOptions): Promise<Buffer>;
    /** Run a shell command on the device. */
    shell(command: string, options?: RunOptions): Promise<string>;
    /** Run a shell command, returning binary stdout. */
    shellRaw(command: string, options?: RunOptions): Promise<Buffer>;
    /**
     * Launch a long-running background process (the transport daemon) and keep
     * the adb shell alive as its supervisor. Returns the adb child process.
     */
    spawnShellDetached(command: string): ChildProcess;
    devices(): Promise<DeviceInfo[]>;
    resolveDevice(explicitSerial?: string): Promise<DeviceInfo>;
    packagePids(packageName: string): Promise<number[]>;
    /**
     * Total frames rendered by the app's process, from `dumpsys gfxinfo`.
     * `null` when the ROM does not report it or the process is gone; the settle
     * probe treats that as "unknown", never as "idle".
     */
    frameCount(packageName: string): Promise<number | null>;
    screenInfo(): Promise<ScreenInfo>;
    foregroundApp(): Promise<ForegroundApp>;
    forwardJdwp(pid: number): Promise<number>;
    forwardAbstract(socketName: string): Promise<number>;
    push(localPath: string, remotePath: string): Promise<void>;
    removeForward(port: number): Promise<void>;
    screenshot(): Promise<Buffer>;
    installViewAttributesFlag(): Promise<boolean>;
}
export declare function shellQuote(value: string): string;
export {};
