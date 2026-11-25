import type { Adb } from "./adb.js";
import type { UiNode } from "./model.js";
export interface Screenshot {
    buffer: Buffer;
    width: number;
    height: number;
    originalWidth: number;
    originalHeight: number;
    /** width / originalWidth. */
    scale: number;
}
export interface ScreenshotOptions {
    /** Downscale so the screenshot is at most this many pixels wide. */
    maxWidth?: number;
    /** Downscale by this factor (0 < scale <= 1). */
    scale?: number;
}
export declare function takeScreenshot(adb: Adb, options?: ScreenshotOptions): Promise<Screenshot>;
export interface ScreenshotMetadata {
    width: number;
    height: number;
    originalWidth: number;
    originalHeight: number;
    screenWidth: number;
    screenHeight: number;
    scale: number;
    coordinateMapping: {
        /** Multiply an image coordinate by this to get the device coordinate. */
        imageToDevice: {
            x: number;
            y: number;
        };
        /** Multiply a device coordinate by this to get the image coordinate. */
        deviceToImage: {
            x: number;
            y: number;
        };
        formula: string;
    };
}
/**
 * Metadata that must accompany a downscaled screenshot. Vision/OCR coordinates
 * are in image pixels, while device coordinates are what `hit` accepts and what
 * gets reported; agents must map them with this factor before quoting a position.
 */
export declare function screenshotMetadata(screenshot: Screenshot): ScreenshotMetadata;
/** Converts a point in downscaled-image pixels to device pixels. */
export declare function imageToDevicePoint(imageX: number, imageY: number, imageWidth: number, imageHeight: number, deviceWidth: number, deviceHeight: number): {
    x: number;
    y: number;
};
export declare function saveScreenshot(screenshot: Screenshot, path: string): Promise<void>;
/**
 * Writes the `<png>.annotated.svg` overlay next to a saved screenshot and
 * returns its path. The SVG references the PNG by file name, so both must stay
 * in the same directory. Shared by the CLI `shot --annotate` and the MCP
 * `screenshot annotate` flows so the file name and SVG content cannot diverge.
 */
export declare function writeAnnotatedSvgFromCapture(shot: Screenshot, roots: UiNode[], treeSource: string, pngPath: string, title?: string): Promise<string>;
/**
 * Downscales a PNG screenshot with a box filter (area average). This keeps the
 * payload small for MCP/agent consumers while remaining readable.
 */
export declare function downscalePng(buffer: Buffer, width: number, height: number, options?: ScreenshotOptions): {
    buffer: Buffer;
    width: number;
    height: number;
    scale: number;
};
export declare function pngSize(buffer: Buffer): {
    width: number;
    height: number;
};
export interface AnnotateOptions {
    pngFileName: string;
    width: number;
    height: number;
    /** Multiply model coordinates (original screenshot pixels) into image pixels. */
    uiScale?: number;
    title?: string;
    maxNodes?: number;
}
/**
 * Renders an SVG overlay with node boxes and refs on top of a screenshot.
 * The SVG references the PNG by file name, so both files should live in the
 * same directory.
 */
export declare function renderAnnotatedSvg(roots: UiNode[], options: AnnotateOptions): string;
