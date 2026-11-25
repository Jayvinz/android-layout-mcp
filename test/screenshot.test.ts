import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  downscalePng,
  imageToDevicePoint,
  pngSize,
  renderAnnotatedSvg,
  screenshotMetadata,
  writeAnnotatedSvgFromCapture,
} from "../src/core/screenshot.js";
import type { UiNode } from "../src/core/model.js";

const original = readFileSync(new URL("./fixtures/screenshot.png", import.meta.url));
const { width, height } = pngSize(original);

test("downscales screenshots by maxWidth with a box filter", () => {
  const result = downscalePng(original, width, height, { maxWidth: 540 });
  assert.equal(result.width, 540);
  assert.equal(result.height, 1200);
  assert.ok(Math.abs(result.scale - 0.5) < 0.001);
  assert.deepEqual(pngSize(result.buffer), { width: 540, height: 1200 });
  assert.ok(result.buffer.length < original.length);
});

test("downscales screenshots by scale and never upscales", () => {
  const quarter = downscalePng(original, width, height, { scale: 0.25 });
  assert.equal(quarter.width, 270);
  assert.equal(quarter.height, 600);
  const untouched = downscalePng(original, width, height, { maxWidth: 4000 });
  assert.equal(untouched.width, width);
  assert.equal(untouched.scale, 1);
});

test("scales annotation boxes with the screenshot", () => {
  const node: UiNode = {
    id: "0",
    ref: "c0",
    source: "compose",
    index: 0,
    depth: 0,
    className: "Box",
    shortClassName: "Box",
    packageName: "p",
    resourceId: null,
    text: null,
    contentDescription: null,
    bounds: { left: 100, top: 200, right: 500, bottom: 300, width: 400, height: 100 },
    visibleBounds: { left: 100, top: 200, right: 500, bottom: 300, width: 400, height: 100 },
    center: { x: 300, y: 250 },
    visible: true,
    enabled: true,
    clickable: false,
    longClickable: false,
    focusable: false,
    focused: false,
    scrollable: false,
    checkable: false,
    checked: false,
    selected: false,
    password: false,
    children: [],
    compose: {
      composeId: "1",
      name: "Box",
      fileName: "A.kt",
      lineNumber: 1,
      offset: 0,
      anchorHash: 0,
      recomposeCount: 0,
      recomposeSkips: 0,
      flags: [],
    },
  };
  const svg = renderAnnotatedSvg([node], {
    pngFileName: "shot.png",
    width: 540,
    height: 1200,
    uiScale: 0.5,
  });
  assert.match(svg, /<rect x="50" y="100" width="200" height="50"/);
});

test("reports how to map image coordinates back to device coordinates", () => {
  const metadata = screenshotMetadata({
    buffer: Buffer.alloc(0),
    width: 720,
    height: 1600,
    originalWidth: 1080,
    originalHeight: 2400,
    scale: 2 / 3,
  });
  assert.equal(metadata.screenWidth, 1080);
  assert.equal(metadata.screenHeight, 2400);
  assert.equal(metadata.coordinateMapping.imageToDevice.x, 1.5);
  assert.equal(metadata.coordinateMapping.imageToDevice.y, 1.5);
  assert.deepEqual(imageToDevicePoint(360, 800, 720, 1600, 1080, 2400), { x: 540, y: 1200 });
  assert.deepEqual(imageToDevicePoint(100, 200, 1080, 2400, 1080, 2400), { x: 100, y: 200 });
});

test("writes <png>.annotated.svg next to the screenshot with the same content as renderAnnotatedSvg", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alm-svg-"));
  try {
    const pngPath = join(dir, "shot.png");
    await writeFile(pngPath, original);
    const shot = {
      buffer: original,
      width,
      height,
      originalWidth: width,
      originalHeight: height,
      scale: 1,
    };
    const node: UiNode = {
      id: "0",
      ref: "v0",
      source: "view",
      index: 0,
      depth: 0,
      className: "android.widget.Button",
      shortClassName: "Button",
      packageName: "p",
      resourceId: null,
      text: "OK",
      contentDescription: null,
      bounds: { left: 10, top: 20, right: 110, bottom: 70, width: 100, height: 50 },
      visibleBounds: { left: 10, top: 20, right: 110, bottom: 70, width: 100, height: 50 },
      center: { x: 60, y: 45 },
      visible: true,
      enabled: true,
      clickable: true,
      longClickable: false,
      focusable: false,
      focused: false,
      scrollable: false,
      checkable: false,
      checked: false,
      selected: false,
      password: false,
      children: [],
    };
    const svgPath = await writeAnnotatedSvgFromCapture(shot, [node], "view", pngPath);
    assert.equal(svgPath, join(dir, "shot.annotated.svg"));
    const written = await readFile(svgPath, "utf8");
    const expected = renderAnnotatedSvg([node], {
      pngFileName: "shot.png",
      width,
      height,
      uiScale: 1,
      title: `view ${width}x${height}`,
    });
    assert.equal(written, expected);
    assert.match(written, /<image href="shot.png"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
