import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { AuiError } from "./errors.js";
const execFileAsync = promisify(execFile);
export class Adb {
    adbPath;
    serial;
    defaultTimeoutMs;
    constructor(options = {}) {
        this.adbPath = options.adbPath || process.env.AUI_ADB || process.env.ADB_PATH || "adb";
        this.serial = options.serial || process.env.ANDROID_SERIAL || undefined;
        this.defaultTimeoutMs = options.timeoutMs ?? 30_000;
    }
    withSerial(serial) {
        return new Adb({ adbPath: this.adbPath, serial, timeoutMs: this.defaultTimeoutMs });
    }
    args(extra, useSerial) {
        const args = [...extra];
        if (useSerial && this.serial) {
            args.unshift("-s", this.serial);
        }
        return args;
    }
    async run(extra, options = {}) {
        const args = this.args(extra, true);
        try {
            const { stdout } = await execFileAsync(this.adbPath, args, {
                encoding: options.encoding === "buffer" ? "buffer" : "utf8",
                timeout: options.timeoutMs ?? this.defaultTimeoutMs,
                maxBuffer: 128 * 1024 * 1024,
                windowsHide: true,
            });
            return stdout;
        }
        catch (error) {
            const err = error;
            if (options.allowFailure) {
                return options.encoding === "buffer"
                    ? Buffer.concat([
                        Buffer.from(err.stdout ?? "", "utf8"),
                        Buffer.from(err.stderr ?? "", "utf8"),
                    ])
                    : `${err.stdout ?? ""}${err.stderr ?? ""}`;
            }
            if (err.code === "ENOENT") {
                throw new AuiError("ADB_NOT_FOUND", `Could not run "${this.adbPath}".`, "Install Android platform-tools or set AUI_ADB to the full path of adb.");
            }
            const stderr = (err.stderr || "").trim();
            if (/timeout/i.test(stderr) || err.killed) {
                throw new AuiError("TIMEOUT", `adb ${extra.join(" ")} timed out.`, "Retry or increase --timeout.");
            }
            throw new AuiError("ADB_FAILED", `adb ${extra.map(quote).join(" ")} failed: ${stderr || err.message}`);
        }
    }
    async out(extra, options = {}) {
        const result = await this.run(extra, { ...options, encoding: "utf8" });
        return String(result).replace(/\r\n/g, "\n").trim();
    }
    async raw(extra, options = {}) {
        const result = await this.run(extra, { ...options, encoding: "buffer" });
        return result;
    }
    /** Run a shell command on the device. */
    async shell(command, options = {}) {
        return this.out(["shell", command], options);
    }
    /** Run a shell command, returning binary stdout. */
    async shellRaw(command, options = {}) {
        return this.raw(["exec-out", command], options);
    }
    /**
     * Launch a long-running background process (the transport daemon) and keep
     * the adb shell alive as its supervisor. Returns the adb child process.
     */
    spawnShellDetached(command) {
        const args = this.args(["shell", command], true);
        return spawn(this.adbPath, args, {
            stdio: "ignore",
            windowsHide: true,
            detached: true,
        });
    }
    async devices() {
        const text = await this.out(["devices", "-l"], { timeoutMs: 15_000 });
        const devices = [];
        for (const line of text.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("List of devices") || trimmed.startsWith("*"))
                continue;
            const parts = trimmed.split(/\s+/);
            const serial = parts[0];
            const state = parts[1] ?? "unknown";
            if (!serial)
                continue;
            const fields = {};
            for (const part of parts.slice(2)) {
                const idx = part.indexOf(":");
                if (idx > 0)
                    fields[part.slice(0, idx)] = part.slice(idx + 1);
            }
            const base = {
                serial,
                state,
                model: fields.model ?? null,
                product: fields.product ?? null,
                device: fields.device ?? null,
                transportId: fields.transport_id ?? null,
                manufacturer: null,
                androidRelease: null,
                sdk: null,
            };
            if (state === "device") {
                try {
                    const props = await this.withSerial(serial).shell("getprop ro.product.manufacturer; getprop ro.build.version.release; getprop ro.build.version.sdk", { timeoutMs: 10_000 });
                    const [manufacturer, release, sdk] = props.split("\n");
                    base.manufacturer = manufacturer?.trim() || null;
                    base.androidRelease = release?.trim() || null;
                    const sdkNum = Number.parseInt((sdk ?? "").trim(), 10);
                    base.sdk = Number.isFinite(sdkNum) ? sdkNum : null;
                }
                catch {
                    // Device info is best-effort.
                }
            }
            devices.push(base);
        }
        return devices;
    }
    async resolveDevice(explicitSerial) {
        const devices = await this.devices();
        const ready = devices.filter((d) => d.state === "device");
        const serial = explicitSerial || this.serial;
        if (serial) {
            const match = ready.find((d) => d.serial === serial);
            if (!match) {
                throw new AuiError("NO_DEVICE", `Device "${serial}" is not connected (ready devices: ${ready.map((d) => d.serial).join(", ") || "none"}).`);
            }
            return match;
        }
        if (ready.length === 0) {
            throw new AuiError("NO_DEVICE", "No ready Android device or emulator found.", "Connect a device, start an emulator, or run `android-ui devices` to see available devices.");
        }
        if (ready.length > 1) {
            throw new AuiError("MULTIPLE_DEVICES", `Multiple devices are connected: ${ready.map((d) => d.serial).join(", ")}.`, "Pass --serial <serial> or set ANDROID_SERIAL.");
        }
        return ready[0];
    }
    async packagePids(packageName) {
        // Prefer the process whose name is exactly the package (the UI process);
        // apps often have additional :remote processes whose pid is returned first
        // by pidof.
        try {
            const ps = await this.shell("ps -A -o PID,NAME", { timeoutMs: 10_000 });
            const exact = ps
                .split("\n")
                .map((line) => line.trim().split(/\s+/))
                .filter((parts) => parts.length >= 2 && parts[1] === packageName)
                .map((parts) => Number.parseInt(parts[0], 10))
                .filter((pid) => Number.isFinite(pid));
            if (exact.length > 0)
                return exact;
        }
        catch {
            // fall through
        }
        try {
            const text = await this.shell(`pidof ${shellQuote(packageName)}`, { timeoutMs: 10_000 });
            const pids = text
                .split(/\s+/)
                .map((v) => Number.parseInt(v, 10))
                .filter((v) => Number.isFinite(v));
            if (pids.length > 0)
                return pids;
        }
        catch {
            // fall through
        }
        return [];
    }
    async screenInfo() {
        const [sizeText, densityText, rotationText] = await Promise.all([
            this.shell("wm size", { timeoutMs: 10_000 }).catch(() => ""),
            this.shell("wm density", { timeoutMs: 10_000 }).catch(() => ""),
            this.shell("dumpsys window | grep -m1 -o 'mRotation=ROTATION_[0-3]'", {
                timeoutMs: 15_000,
                allowFailure: true,
            }).catch(() => ""),
        ]);
        let width = 0;
        let height = 0;
        const sizeMatch = sizeText.match(/Override size:\s*(\d+)x(\d+)/) ?? sizeText.match(/Physical size:\s*(\d+)x(\d+)/);
        if (sizeMatch) {
            width = Number.parseInt(sizeMatch[1], 10);
            height = Number.parseInt(sizeMatch[2], 10);
        }
        let densityDpi = 160;
        const densityMatch = densityText.match(/Override density:\s*(\d+)/) ?? densityText.match(/Physical density:\s*(\d+)/);
        if (densityMatch)
            densityDpi = Number.parseInt(densityMatch[1], 10);
        let rotation = null;
        const rotationMatch = rotationText.match(/mRotation=ROTATION_(\d)/);
        if (rotationMatch)
            rotation = Number.parseInt(rotationMatch[1], 10);
        const orientation = rotation === null
            ? width > 0 && height > 0
                ? width > height
                    ? "landscape"
                    : "portrait"
                : "unknown"
            : rotation % 2 === 1
                ? "landscape"
                : "portrait";
        return {
            width,
            height,
            density: densityDpi / 160,
            densityDpi,
            orientation,
            rotation,
        };
    }
    async foregroundApp() {
        try {
            const windowFocus = await this.shell("dumpsys window | grep -m1 mCurrentFocus", {
                timeoutMs: 15_000,
                allowFailure: true,
            });
            const match = windowFocus.match(/mCurrentFocus=.*?\s+([\w.]+)\/([\w.$]+)/);
            if (match) {
                return { packageName: match[1], activity: match[2], raw: windowFocus.trim() };
            }
        }
        catch {
            // fall through
        }
        try {
            const activity = await this.shell("dumpsys activity activities | grep -m1 topResumedActivity", { timeoutMs: 20_000, allowFailure: true });
            const match = activity.match(/([\w.]+)\/([\w.$]+)/);
            if (match) {
                return { packageName: match[1], activity: match[2], raw: activity.trim() };
            }
        }
        catch {
            // fall through
        }
        try {
            // Some ROMs (MIUI) omit topResumedActivity from `dumpsys activity
            // activities`, and the notification shade can steal mCurrentFocus.
            const top = await this.shell("dumpsys activity top | grep -m1 'ACTIVITY '", {
                timeoutMs: 20_000,
                allowFailure: true,
            });
            const match = top.match(/ACTIVITY\s+([\w.]+)\/([\w.$]+)/);
            if (match) {
                return { packageName: match[1], activity: match[2], raw: top.trim() };
            }
        }
        catch {
            // fall through
        }
        return { packageName: null, activity: null, raw: null };
    }
    async forwardJdwp(pid) {
        const text = await this.out(["forward", "tcp:0", `jdwp:${pid}`], { timeoutMs: 15_000 });
        const port = Number.parseInt(text.trim(), 10);
        if (!Number.isFinite(port) || port <= 0) {
            throw new AuiError("JDWP_FAILED", `adb refused to forward jdwp:${pid}: ${text.trim()}`, "The app may not be debuggable. Use --source semantics for a UI dump of non-debuggable apps.");
        }
        return port;
    }
    async forwardAbstract(socketName) {
        const text = await this.out(["forward", "tcp:0", `localabstract:${socketName}`], { timeoutMs: 15_000 });
        const port = Number.parseInt(text.trim(), 10);
        if (!Number.isFinite(port) || port <= 0) {
            throw new AuiError("COMPOSE_FAILED", `adb could not forward localabstract:${socketName}: ${text.trim()}`);
        }
        return port;
    }
    async push(localPath, remotePath) {
        await this.out(["push", localPath, remotePath], { timeoutMs: 120_000 });
    }
    async removeForward(port) {
        try {
            await this.out(["forward", "--remove", `tcp:${port}`], { timeoutMs: 10_000, allowFailure: true });
        }
        catch {
            // ignore
        }
    }
    async screenshot() {
        return this.raw(["exec-out", "screencap", "-p"], {
            timeoutMs: 30_000,
            encoding: "buffer",
        });
    }
    async inputTap(x, y) {
        await this.shell(`input tap ${Math.round(x)} ${Math.round(y)}`, { timeoutMs: 15_000 });
    }
    async inputSwipe(x1, y1, x2, y2, durationMs = 300) {
        await this.shell(`input swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${Math.round(durationMs)}`, { timeoutMs: 30_000 });
    }
    async inputText(text) {
        const encoded = text
            .replace(/\\/g, "\\\\")
            .replace(/([%'"`$&;|<>()*?![\]{}#~ ])/g, (ch) => (ch === " " ? "%s" : `\\${ch}`));
        await this.shell(`input text ${encoded}`, { timeoutMs: 15_000 });
    }
    async keyEvent(key) {
        await this.shell(`input keyevent ${shellQuote(key)}`, { timeoutMs: 15_000 });
    }
    async installViewAttributesFlag() {
        // Android Studio enables this for richer ViewDebug properties. It restarts the app.
        try {
            await this.shell("settings put global debug_view_attributes 1", { timeoutMs: 10_000 });
            return true;
        }
        catch {
            return false;
        }
    }
}
export function shellQuote(value) {
    if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value))
        return value;
    return `'${value.replace(/'/g, "'\\''")}'`;
}
function quote(value) {
    return /\s/.test(value) ? `"${value}"` : value;
}
