export interface McpServerOptions {
    serial?: string;
    adb?: string;
    timeout?: number;
    studioPath?: string;
    javaPath?: string;
    composeVersion?: string;
}
export declare function startMcpServer(options?: McpServerOptions): Promise<void>;
