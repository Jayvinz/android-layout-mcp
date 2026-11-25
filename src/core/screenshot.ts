import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { PNG } from "pngjs";
import type { Adb } from "./adb.js";
import { AuiError } from "./errors.js";
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

export async function takeScreenshot(adb: Adb, options: ScreenshotOptions = {}): Promise<Screenshot> {
  const buffer = await adb.screenshot();
  const size = pngSize(buffer);
  const scaled = downscalePng(buffer, size.width, size.height, options);
  return {
    buffer: scaled.buffer,
    width: scaled.width,
    height: scaled.height,
    originalWidth: size.width,
    originalHeight: size.height,
    scale: scaled.scale,
  };
}

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
    imageToDevice: { x: number; y: number };
    /** Multiply a device coordinate by this to get the image coordinate. */
    deviceToImage: { x: number; y: number };
    formula: string;
  };
}

/**
 * Metadata that must accompany a downscaled screenshot. Vision/OCR coordinates
 * are in image pixels, while device coordinates are what `hit` accepts and what
 * gets reported; agents must map them with this factor before quoting a position.
 */
export function screenshotMetadata(screenshot: Screenshot): ScreenshotMetadata {
  const factorX = screenshot.width > 0 ? screenshot.originalWidth / screenshot.width : 1;
  const factorY = screenshot.height > 0 ? screenshot.originalHeight / screenshot.height : 1;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    width: screenshot.width,
    height: screenshot.height,
    originalWidth: screenshot.originalWidth,
    originalHeight: screenshot.originalHeight,
    screenWidth: screenshot.originalWidth,
    screenHeight: screenshot.originalHeight,
    scale: screenshot.scale,
    coordinateMapping: {
      imageToDevice: { x: round(factorX), y: round(factorY) },
      deviceToImage: { x: round(1 / factorX), y: round(1 / factorY) },
      formula:
        `deviceX = round(imageX * ${round(factorX)}); ` +
        `deviceY = round(imageY * ${round(factorY)})`,
    },
  };
}

/** Converts a point in downscaled-image pixels to device pixels. */
export function imageToDevicePoint(
  imageX: number,
  imageY: number,
  imageWidth: number,
  imageHeight: number,
  deviceWidth: number,
  deviceHeight: number,
): { x: number; y: number } {
  if (imageWidth <= 0 || imageHeight <= 0 || deviceWidth <= 0 || deviceHeight <= 0) {
    throw new AuiError("BAD_INPUT", "Image and device dimensions must be positive.");
  }
  return {
    x: Math.round((imageX * deviceWidth) / imageWidth),
    y: Math.round((imageY * deviceHeight) / imageHeight),
  };
}

export async function saveScreenshot(screenshot: Screenshot, path: string): Promise<void> {
  await writeFile(path, screenshot.buffer);
}

/**
 * Writes the `<png>.annotated.svg` overlay next to a saved screenshot and
 * returns its path. The SVG references the PNG by file name, so both must stay
 * in the same directory. Shared by the CLI `shot --annotate` and the MCP
 * `screenshot annotate` flows so the file name and SVG content cannot diverge.
 */
export async function writeAnnotatedSvgFromCapture(
  shot: Screenshot,
  roots: UiNode[],
  treeSource: string,
  pngPath: string,
  title?: string,
): Promise<string> {
  const svgPath = pngPath.replace(/\.png$/i, "") + ".annotated.svg";
  await writeFile(
    svgPath,
    renderAnnotatedSvg(roots, {
      pngFileName: basename(pngPath),
      width: shot.width,
      height: shot.height,
      uiScale: shot.scale,
      title: title ?? `${treeSource} ${shot.width}x${shot.height}`,
    }),
  );
  return svgPath;
}

/**
 * Downscales a PNG screenshot with a box filter (area average). This keeps the
 * payload small for MCP/agent consumers while remaining readable.
 */
export function downscalePng(
  buffer: Buffer,
  width: number,
  height: number,
  options: ScreenshotOptions = {},
): { buffer: Buffer; width: number; height: number; scale: number } {
  const requestedWidth =
    options.maxWidth && options.maxWidth > 0
      ? Math.min(width, Math.round(options.maxWidth))
      : options.scale && options.scale > 0 && options.scale < 1
        ? Math.max(1, Math.round(width * options.scale))
        : width;
  const targetWidth = Math.max(1, Math.min(width, requestedWidth));
  if (targetWidth >= width) {
    return { buffer, width, height, scale: 1 };
  }
  const targetHeight = Math.max(1, Math.round((height * targetWidth) / width));

  let png: PNG;
  try {
    png = PNG.sync.read(buffer);
  } catch (error) {
    throw new AuiError("SCREENSHOT_FAILED", `Could not decode the device screenshot: ${String(error)}`);
  }
  const source = png.data;
  const target = Buffer.alloc(targetWidth * targetHeight * 4);
  const xRanges = bucketRanges(width, targetWidth);
  const yRanges = bucketRanges(height, targetHeight);

  for (let ty = 0; ty < targetHeight; ty++) {
    const [sy0, sy1] = yRanges[ty];
    for (let tx = 0; tx < targetWidth; tx++) {
      const [sx0, sx1] = xRanges[tx];
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        let offset = (sy * width + sx0) * 4;
        for (let sx = sx0; sx < sx1; sx++) {
          r += source[offset];
          g += source[offset + 1];
          b += source[offset + 2];
          a += source[offset + 3];
          offset += 4;
          count++;
        }
      }
      const destination = (ty * targetWidth + tx) * 4;
      target[destination] = Math.round(r / count);
      target[destination + 1] = Math.round(g / count);
      target[destination + 2] = Math.round(b / count);
      target[destination + 3] = Math.round(a / count);
    }
  }
  const output = new PNG({ width: targetWidth, height: targetHeight });
  target.copy(output.data);
  const encoded = PNG.sync.write(output);
  return { buffer: encoded, width: targetWidth, height: targetHeight, scale: targetWidth / width };
}

/** Maps each destination pixel to a non-empty [start, end) source range. */
function bucketRanges(sourceSize: number, targetSize: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < targetSize; i++) {
    const start = Math.floor((i * sourceSize) / targetSize);
    const end = Math.max(start + 1, Math.floor(((i + 1) * sourceSize) / targetSize));
    ranges.push([start, Math.min(sourceSize, end)]);
  }
  return ranges;
}

export function pngSize(buffer: Buffer): { width: number; height: number } {
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) {
    throw new AuiError("SCREENSHOT_FAILED", "The device did not return a PNG screenshot.");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

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
export function renderAnnotatedSvg(roots: UiNode[], options: AnnotateOptions): string {
  const maxNodes = options.maxNodes ?? 200;
  const scale = options.uiScale ?? 1;
  const fontSize = Math.max(8, Math.round(11 * scale));
  const rects: string[] = [];
  let count = 0;
  const walk = (node: UiNode) => {
    if (count >= maxNodes) return;
    const bounds = node.visibleBounds;
    if (bounds && (node.clickable || node.text || node.contentDescription || node.compose)) {
      count++;
      const color = node.clickable ? "#ff3b6b" : "#5ec8ff";
      const label = escapeXml(
        `${node.ref} ${node.shortClassName}${node.text ? ` "${node.text.slice(0, 24)}"` : ""}`,
      );
      const x = bounds.left * scale;
      const y = bounds.top * scale;
      const width = bounds.width * scale;
      const height = bounds.height * scale;
      rects.push(
        `<rect x="${x}" y="${y}" width="${width}" height="${height}" ` +
          `fill="none" stroke="${color}" stroke-width="1.5" />`,
      );
      const labelY = Math.max(fontSize, y - 3);
      rects.push(
        `<text x="${x + 2}" y="${labelY}" font-family="monospace" font-size="${fontSize}" ` +
          `fill="${color}" stroke="#000" stroke-width="2.5" paint-order="stroke">${label}</text>`,
      );
    }
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  const title = options.title
    ? `<text x="12" y="24" font-family="monospace" font-size="14" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke">${escapeXml(options.title)}</text>`
    : "";
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${options.width}" height="${options.height}" viewBox="0 0 ${options.width} ${options.height}">`,
    `<image href="${escapeXml(options.pngFileName)}" width="${options.width}" height="${options.height}" />`,
    title,
    ...rects,
    `</svg>`,
  ].join("\n");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}