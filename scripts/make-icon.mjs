#!/usr/bin/env node
/**
 * Generates .claude-plugin/icon.png (512x512) with no image dependencies
 * beyond pngjs, which is already used by the screenshot tooling.
 *
 * Run: node scripts/make-icon.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".claude-plugin", "icon.png");
const SIZE = 512;
const SS = 2; // supersample factor
const W = SIZE * SS;

const COLORS = {
  bg: [13, 17, 23, 255],
  border: [48, 54, 61, 255],
  line: [139, 148, 158, 255],
  green: [126, 231, 135, 255],
  blue: [88, 166, 255, 255],
  panel: [22, 27, 34, 255],
  white: [240, 246, 252, 255],
};

function sdRoundRect(px, py, cx, cy, w, h, r) {
  const qx = Math.abs(px - cx) - (w / 2 - r);
  const qy = Math.abs(py - cy) - (h / 2 - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len = vx * vx + vy * vy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len));
  const dx = px - (ax + vx * t);
  const dy = py - (ay + vy * t);
  return Math.sqrt(dx * dx + dy * dy);
}

const buffer = new Uint8ClampedArray(W * W * 4);

function blend(x, y, color) {
  if (x < 0 || y < 0 || x >= W || y >= W) return;
  const i = (y * W + x) * 4;
  const a = color[3] / 255;
  buffer[i] = buffer[i] * (1 - a) + color[0] * a;
  buffer[i + 1] = buffer[i + 1] * (1 - a) + color[1] * a;
  buffer[i + 2] = buffer[i + 2] * (1 - a) + color[2] * a;
  buffer[i + 3] = Math.max(buffer[i + 3], color[3]);
}

function paint(shape, color) {
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const px = (x + 0.5) / SS;
      const py = (y + 0.5) / SS;
      if (shape(px, py)) blend(x, y, color);
    }
  }
}

function strokeRoundRect(cx, cy, w, h, r, width, color) {
  paint(
    (px, py) => Math.abs(sdRoundRect(px, py, cx, cy, w, h, r)) <= width / 2,
    color,
  );
}

function fillRoundRect(cx, cy, w, h, r, color) {
  paint((px, py) => sdRoundRect(px, py, cx, cy, w, h, r) <= 0, color);
}

function line(ax, ay, bx, by, width, color) {
  paint((px, py) => sdSegment(px, py, ax, ay, bx, by) <= width / 2, color);
}

function circle(cx, cy, r, width, color) {
  paint((px, py) => Math.abs(Math.hypot(px - cx, py - cy) - r) <= width / 2, color);
}

function dot(cx, cy, r, color) {
  paint((px, py) => Math.hypot(px - cx, py - cy) <= r, color);
}

// Background panel.
fillRoundRect(SIZE / 2, SIZE / 2, 496, 496, 104, COLORS.bg);
strokeRoundRect(SIZE / 2, SIZE / 2, 496, 496, 104, 3, COLORS.border);

// View-tree: root and two children.
line(200, 193, 200, 226, 4, COLORS.line);
line(200, 226, 180, 226, 4, COLORS.line);
line(200, 226, 350, 226, 4, COLORS.line);
line(180, 226, 180, 264, 4, COLORS.line);
line(350, 226, 350, 264, 4, COLORS.line);

strokeRoundRect(200, 150, 190, 88, 18, 5, COLORS.green);
strokeRoundRect(180, 300, 154, 74, 15, 4, COLORS.blue);
strokeRoundRect(350, 300, 130, 74, 15, 4, COLORS.blue);

// Bounds handles on the root.
for (const [x, y] of [
  [105, 106], [295, 106], [105, 194], [295, 194],
]) dot(x, y, 5, COLORS.green);

// Content lines inside the panels.
line(132, 150, 190, 150, 3, COLORS.green);
line(132, 168, 160, 168, 3, COLORS.green);
line(126, 300, 166, 300, 3, COLORS.blue);
line(308, 300, 360, 300, 3, COLORS.blue);

// Inspector magnifier.
circle(392, 392, 50, 7, COLORS.white);
line(428, 428, 468, 468, 13, COLORS.white);

// Downsample with a box filter.
const png = new PNG({ width: SIZE, height: SIZE });
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const i = ((y * SS + sy) * W + (x * SS + sx)) * 4;
        r += buffer[i];
        g += buffer[i + 1];
        b += buffer[i + 2];
        a += buffer[i + 3];
      }
    }
    const n = SS * SS;
    const i = (y * SIZE + x) * 4;
    png.data[i] = Math.round(r / n);
    png.data[i + 1] = Math.round(g / n);
    png.data[i + 2] = Math.round(b / n);
    png.data[i + 3] = Math.round(a / n);
  }
}

await mkdir(dirname(OUT), { recursive: true });
const bytes = PNG.sync.write(png, { colorType: 6 });
await writeFile(OUT, bytes);
console.log(`wrote ${OUT} (${bytes.length} bytes)`);
