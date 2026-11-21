import type { Adb } from "./adb.js";
import type { WindowInfo } from "./model.js";
export interface JdwpOptions {
    requestTimeoutMs?: number;
    connectTimeoutMs?: number;
}
export declare class JdwpClient {
    private readonly socket;
    private readonly port;
    private readonly adb;
    private readonly requestTimeoutMs;
    private nextId;
    private rx;
    private handshakeDone;
    private handshakeResolve;
    private handshakeReject;
    private handshakeTimer;
    private pending;
    private closed;
    private constructor();
    static open(adb: Adb, pid: number, options?: JdwpOptions): Promise<JdwpClient>;
    private handshake;
    private checkHandshake;
    private failHandshake;
    private onData;
    private processBuffer;
    private takePacket;
    private writePacket;
    private sendCommand;
    private sendResume;
    private ddm;
    private parseChunkReply;
    listWindows(): Promise<WindowInfo[]>;
    /**
     * Dump the view hierarchy for a window using the v2 binary protocol.
     * Returns the raw bytes produced by android.view.ViewDebug.dumpv2().
     */
    dumpViewHierarchy(windowName: string): Promise<Buffer>;
    close(): Promise<void>;
    private failAll;
}
