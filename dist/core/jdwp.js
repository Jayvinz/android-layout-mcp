import net from "node:net";
import { AlmError, errorMessage } from "./errors.js";
const JDWP_HANDSHAKE = Buffer.from("JDWP-Handshake", "ascii");
const DDMS_CMD_SET = 0xc7;
const DDMS_CMD = 0x01;
const CHUNK_VULW = "VULW";
const CHUNK_VURT = "VURT";
export class JdwpClient {
    socket;
    port;
    adb;
    requestTimeoutMs;
    nextId = 1;
    rx = Buffer.alloc(0);
    handshakeDone = false;
    handshakeResolve = null;
    handshakeReject = null;
    handshakeTimer = null;
    pending = new Map();
    closed = false;
    constructor(socket, port, adb, options) {
        this.socket = socket;
        this.port = port;
        this.adb = adb;
        this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
        socket.setNoDelay(true);
        socket.on("data", (chunk) => this.onData(chunk));
        socket.on("error", (error) => this.failAll(error));
        socket.on("close", () => {
            this.closed = true;
            this.failAll(new Error("JDWP connection closed"));
        });
    }
    static async open(adb, pid, options = {}) {
        const port = await adb.forwardJdwp(pid);
        const connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
        const socket = net.connect({ host: "127.0.0.1", port });
        try {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    socket.destroy();
                    reject(new Error(`Timed out connecting to JDWP port ${port}`));
                }, connectTimeoutMs);
                socket.once("connect", () => {
                    clearTimeout(timer);
                    resolve();
                });
                socket.once("error", (error) => {
                    clearTimeout(timer);
                    reject(error);
                });
            });
        }
        catch (error) {
            socket.destroy();
            await adb.removeForward(port);
            throw new AlmError("JDWP_FAILED", `Could not connect to the app over JDWP: ${errorMessage(error)}`, "Make sure the app is running and debuggable. Use --source semantics for non-debuggable apps.");
        }
        const client = new JdwpClient(socket, port, adb, options);
        try {
            await client.handshake(connectTimeoutMs);
            // Attaching a debugger can suspend the VM. Resume it so the UI keeps
            // running while we read the view tree.
            client.sendResume();
            return client;
        }
        catch (error) {
            await client.close();
            throw error;
        }
    }
    handshake(timeoutMs) {
        return new Promise((resolve, reject) => {
            this.handshakeResolve = resolve;
            this.handshakeReject = reject;
            this.handshakeTimer = setTimeout(() => {
                this.failHandshake(new AlmError("JDWP_FAILED", "Timed out waiting for the JDWP handshake.", "The process may not be debuggable, or another debugger is attached."));
            }, timeoutMs);
            this.socket.write(JDWP_HANDSHAKE);
            // The response may have arrived synchronously with the write.
            this.checkHandshake();
        });
    }
    checkHandshake() {
        if (this.handshakeDone)
            return;
        if (this.rx.length < JDWP_HANDSHAKE.length)
            return;
        if (!this.rx.subarray(0, JDWP_HANDSHAKE.length).equals(JDWP_HANDSHAKE)) {
            this.failHandshake(new AlmError("JDWP_FAILED", "The device rejected the JDWP handshake."));
            return;
        }
        this.rx = this.rx.subarray(JDWP_HANDSHAKE.length);
        this.handshakeDone = true;
        if (this.handshakeTimer)
            clearTimeout(this.handshakeTimer);
        this.handshakeTimer = null;
        const resolve = this.handshakeResolve;
        this.handshakeResolve = null;
        this.handshakeReject = null;
        resolve?.();
        this.processBuffer();
    }
    failHandshake(error) {
        if (this.handshakeTimer)
            clearTimeout(this.handshakeTimer);
        this.handshakeTimer = null;
        const reject = this.handshakeReject;
        this.handshakeResolve = null;
        this.handshakeReject = null;
        reject?.(error);
    }
    onData(chunk) {
        this.rx = Buffer.concat([this.rx, chunk]);
        if (!this.handshakeDone) {
            this.checkHandshake();
            return;
        }
        this.processBuffer();
    }
    processBuffer() {
        while (true) {
            const reply = this.takePacket();
            if (!reply)
                return;
            if ((reply.flags & 0x80) === 0)
                continue; // VM events / unsolicited packets
            const pending = this.pending.get(reply.id);
            if (!pending)
                continue;
            this.pending.delete(reply.id);
            clearTimeout(pending.timer);
            pending.resolve(reply);
        }
    }
    takePacket() {
        if (this.rx.length < 11)
            return null;
        const length = this.rx.readUInt32BE(0);
        if (length < 11) {
            this.rx = Buffer.alloc(0);
            this.failAll(new Error("Malformed JDWP packet"));
            return null;
        }
        if (this.rx.length < length)
            return null;
        const packet = this.rx.subarray(0, length);
        this.rx = this.rx.subarray(length);
        return {
            id: packet.readUInt32BE(4),
            flags: packet[8],
            commandSet: packet[9],
            command: packet[10],
            payload: packet.subarray(11),
        };
    }
    writePacket(commandSet, command, payload, id) {
        if (this.closed)
            throw new AlmError("JDWP_FAILED", "JDWP connection is closed.");
        const header = Buffer.alloc(11);
        header.writeUInt32BE(11 + payload.length, 0);
        header.writeUInt32BE(id, 4);
        header[8] = 0;
        header[9] = commandSet;
        header[10] = command;
        this.socket.write(Buffer.concat([header, payload]));
    }
    sendCommand(commandSet, command, payload) {
        const id = this.nextId++;
        try {
            this.writePacket(commandSet, command, payload, id);
        }
        catch (error) {
            return Promise.reject(error);
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new AlmError("TIMEOUT", "Timed out waiting for a response from the app over JDWP."));
            }, this.requestTimeoutMs);
            this.pending.set(id, { resolve, reject, timer });
        });
    }
    sendResume() {
        try {
            this.writePacket(1, 9, Buffer.alloc(0), this.nextId++);
        }
        catch {
            // best effort
        }
    }
    async ddm(chunkType, data) {
        const chunk = Buffer.alloc(8 + data.length);
        chunk.write(chunkType, 0, "ascii");
        chunk.writeUInt32BE(data.length, 4);
        data.copy(chunk, 8);
        const reply = await this.sendCommand(DDMS_CMD_SET, DDMS_CMD, chunk);
        return this.parseChunkReply(reply.payload);
    }
    parseChunkReply(payload) {
        if (payload.length < 8) {
            throw new AlmError("JDWP_FAILED", "Received a truncated DDM chunk from the app.");
        }
        const type = payload.subarray(0, 4).toString("ascii");
        const length = payload.readUInt32BE(4);
        const data = payload.subarray(8, 8 + length);
        if (type === "FAIL") {
            let message = "The app rejected the view debug request.";
            try {
                const code = data.readInt32BE(0);
                const chars = data.readInt32BE(4);
                message = `${decodeUtf16(data.subarray(8, 8 + chars * 2))} (code ${code})`;
            }
            catch {
                // keep default message
            }
            throw new AlmError("VIEW_DUMP_FAILED", message);
        }
        if (data.length !== length) {
            throw new AlmError("JDWP_FAILED", `Truncated ${type} chunk received from the app.`);
        }
        return Buffer.concat([Buffer.from(type, "ascii"), data]);
    }
    async listWindows() {
        const reply = await this.ddm(CHUNK_VULW, int32(1));
        const type = reply.subarray(0, 4).toString("ascii");
        const data = reply.subarray(4);
        if (type !== CHUNK_VULW) {
            throw new AlmError("JDWP_FAILED", `Unexpected DDM reply "${type}" for window list.`);
        }
        const count = data.readInt32BE(0);
        let offset = 4;
        const windows = [];
        for (let i = 0; i < count; i++) {
            const chars = data.readInt32BE(offset);
            offset += 4;
            const name = decodeUtf16(data.subarray(offset, offset + chars * 2));
            offset += chars * 2;
            const parts = name.split("/");
            windows.push({
                index: i,
                name,
                packageName: parts[0] || null,
                activity: parts.length > 1 ? parts[1] : null,
            });
        }
        return windows;
    }
    /**
     * Dump the view hierarchy for a window using the v2 binary protocol.
     * Returns the raw bytes produced by android.view.ViewDebug.dumpv2().
     */
    async dumpViewHierarchy(windowName) {
        const payload = Buffer.concat([
            int32(1), // VURT_DUMP_HIERARCHY
            int32(windowName.length),
            utf16be(windowName),
            int32(0), // skipChildren = false
            int32(1), // includeProperties = true
            int32(1), // use v2 binary protocol
        ]);
        const reply = await this.ddm(CHUNK_VURT, payload);
        const type = reply.subarray(0, 4).toString("ascii");
        if (type !== CHUNK_VURT) {
            throw new AlmError("VIEW_DUMP_FAILED", `Unexpected DDM reply "${type}" for view dump.`);
        }
        return reply.subarray(4);
    }
    async close() {
        if (!this.closed) {
            this.sendResume();
            this.closed = true;
            // Give the resume packet a chance to leave the socket before closing.
            await new Promise((resolve) => setTimeout(resolve, 20));
            this.socket.destroy();
        }
        this.failAll(new Error("JDWP client closed"));
        await this.adb.removeForward(this.port);
    }
    failAll(error) {
        for (const [, pending] of this.pending) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pending.clear();
    }
}
function int32(value) {
    const buffer = Buffer.alloc(4);
    buffer.writeInt32BE(value);
    return buffer;
}
/** The Android view-debug protocol encodes strings as UTF-16BE. */
function utf16be(value) {
    return Buffer.from(value, "utf16le").swap16();
}
function decodeUtf16(buffer) {
    const even = buffer.length - (buffer.length % 2);
    return Buffer.from(buffer.subarray(0, even)).swap16().toString("utf16le");
}
