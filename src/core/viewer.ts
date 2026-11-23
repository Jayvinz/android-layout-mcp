import { spawn } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AnalyzeResult, CaptureResult, NodeSource, ScreenInfo, UiKind, UiNode } from "./model.js";
import { issuesToJson } from "./analyze.js";
import { errorMessage } from "./errors.js";
import type { Screenshot } from "./screenshot.js";
import { flattenNodes, serializeNode } from "./viewdump.js";

/**
 * Interactive, self-contained HTML snapshot of one capture.
 *
 * Browser launch is always explicit: nothing in this module is called by
 * dump/find/analyze/screenshot/verify flows. The HTML has no network access
 * (CSP `connect-src 'none'`, no external assets) and every captured string is
 * written through `textContent` by the inline viewer script.
 */

export interface ViewerOptions {
  screenshot?: Screenshot | null;
  analysis?: AnalyzeResult | null;
  /** Maximum serialized nodes per tree. Default 4000. */
  maxNodes?: number;
  /** Embed raw `view.properties`. Default false. */
  includeProperties?: boolean;
  title?: string;
  createdAt?: string;
}

export interface ViewerTreePayload {
  source: NodeSource;
  roots: unknown[];
  /** Nodes actually serialized before the cap was hit. */
  nodeCount: number;
  /** Nodes present in the captured tree. */
  totalNodes: number;
  truncated: boolean;
}

export interface ViewerScreenshotPayload {
  dataUri: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  scale: number;
  /** Multiply an image coordinate by this to get a device coordinate. */
  imageToDevice: { x: number; y: number };
}

export interface ViewerIssuePayload {
  rule: string;
  severity: string;
  source: NodeSource;
  nodeId: string;
  ref: string;
  className: string;
  label: string | null;
  message: string;
  bounds: unknown;
}

export interface ViewerIssuesPayload {
  counts: Record<string, number>;
  dp: number;
  nodeCount: number;
  issues: ViewerIssuePayload[];
}

export interface ViewerMeta {
  version: 1;
  createdAt: string;
  title: string;
  device: {
    serial: string;
    model: string | null;
    androidRelease: string | null;
    sdk: number | null;
  };
  target: {
    packageName: string | null;
    pid: number | null;
    activity: string | null;
    debuggable: boolean | null;
    window: string | null;
    windows: string[];
  };
  screen: ScreenInfo;
  source: NodeSource;
  primarySource: NodeSource;
  sources: NodeSource[];
  uiKind: UiKind;
  warnings: string[];
  limits: {
    maxNodes: number;
    includeProperties: boolean;
    budgetBytes: number;
    budgetExceeded: boolean;
  };
}

export interface ViewerPayload {
  meta: ViewerMeta;
  trees: Partial<Record<NodeSource, ViewerTreePayload>>;
  screenshot: ViewerScreenshotPayload | null;
  issues: ViewerIssuesPayload | null;
}

export interface OpenResult {
  opened: boolean;
  browser?: string;
  error?: string;
}

export interface OpenBrowserOptions {
  launcher?: (path: string) => Promise<void> | void;
}

export const VIEWER_BUDGET_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_NODES = 4000;
const MIN_NODES = 200;

/** `<baseDir or cwd>/.dli/viewer.html`, using the platform separator. */
export function defaultViewerPath(baseDir?: string): string {
  return join(baseDir ?? process.cwd(), ".dli", "viewer.html");
}

/** Builds the embedded JSON payload, enforcing the 8 MB budget. */
export function viewerPayload(result: CaptureResult, options: ViewerOptions = {}): ViewerPayload {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const requestedMaxNodes =
    options.maxNodes && options.maxNodes > 0 ? Math.floor(options.maxNodes) : DEFAULT_MAX_NODES;
  const screenshot = options.screenshot ? screenshotPayload(options.screenshot, result.screen) : null;
  const issues = options.analysis
    ? (issuesToJson(options.analysis) as unknown as ViewerIssuesPayload)
    : null;

  let includeProperties = options.includeProperties === true;
  let maxNodes = requestedMaxNodes;
  let budgetExceeded = false;

  const build = (): ViewerPayload =>
    buildPayload(result, {
      createdAt,
      title: options.title ?? defaultTitle(result),
      maxNodes,
      includeProperties,
      screenshot,
      issues,
    });

  let payload = build();
  if (payloadBytes(payload) > VIEWER_BUDGET_BYTES && includeProperties) {
    includeProperties = false;
    budgetExceeded = true;
    payload = build();
  }

  let guard = 0;
  while (payloadBytes(payload) > VIEWER_BUDGET_BYTES && maxNodes > MIN_NODES && guard < 20) {
    maxNodes = Math.max(MIN_NODES, Math.floor(maxNodes / 2));
    budgetExceeded = true;
    payload = build();
    guard += 1;
  }

  if (budgetExceeded) payload.meta.limits.budgetExceeded = true;
  return payload;
}

/** Renders a complete, offline HTML document for one capture. */
export function renderViewerHtml(result: CaptureResult, options: ViewerOptions = {}): string {
  return renderViewerHtmlFromPayload(viewerPayload(result, options));
}

/** Renders HTML for an already-built payload (avoids serialising twice). */
export function renderViewerHtmlFromPayload(payload: ViewerPayload): string {
  const json = escapeForScript(JSON.stringify(payload));
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
    "<title>UI viewer</title>",
    `<style>${VIEWER_CSS}</style>`,
    "</head>",
    "<body>",
    '<header id="app-header">',
    '  <div class="header-top">',
    '    <h1 id="app-title">UI viewer</h1>',
    '    <div class="legend" aria-label="Overlay legend">',
    '      <span class="legend-item"><span class="swatch click"></span>clickable</span>',
    '      <span class="legend-item"><span class="swatch label"></span>labelled</span>',
    '      <span class="legend-item"><span class="swatch selected"></span>selected</span>',
    '      <span class="legend-item"><span class="swatch issue"></span>issue</span>',
    '      <span class="legend-item"><span class="swatch raw"></span>clipped raw bounds</span>',
    "    </div>",
    "  </div>",
    '  <div id="meta-line" class="meta-line"></div>',
    '  <div id="warnings" class="warnings" hidden></div>',
    "</header>",
    "<main>",
    '  <section class="panel panel-tree" aria-label="UI tree">',
    '    <div class="panel-toolbar">',
    '      <input id="search" type="search" placeholder="Search nodes (press /)" aria-label="Search nodes">',
    '      <span id="match-count" class="match-count" aria-live="polite"></span>',
    '      <div class="filters">',
    '        <label class="check"><input type="checkbox" id="clickable-only"> clickable only</label>',
    '        <label class="check"><input type="checkbox" id="visible-only" checked> visible only</label>',
    "      </div>",
    '      <div class="tree-actions">',
    '        <button type="button" id="expand-all">Expand</button>',
    '        <button type="button" id="collapse-all">Collapse</button>',
    "      </div>",
    "    </div>",
    '    <div id="source-tabs" class="source-tabs" role="tablist" aria-label="Data source"></div>',
    '    <div id="tree" class="tree" role="tree" aria-label="Node tree"></div>',
    "  </section>",
    '  <section class="panel panel-stage" aria-label="Screenshot and overlay">',
    '    <div id="stage-wrap" class="stage-wrap">',
    '      <div id="stage" class="stage">',
    '        <img id="shot" alt="Device screenshot" hidden>',
    '        <svg id="overlay" class="overlay" hidden></svg>',
    '        <div id="no-shot" class="no-shot" hidden></div>',
    "      </div>",
    "    </div>",
    '    <div class="stage-bar">',
    '      <button type="button" id="zoom-out" aria-label="Zoom out">-</button>',
    '      <button type="button" id="zoom-in" aria-label="Zoom in">+</button>',
    '      <button type="button" id="fit">Fit</button>',
    '      <span id="zoom-label" class="zoom-label">100%</span>',
    '      <span id="coord-readout" class="coord-readout"></span>',
    "    </div>",
    "  </section>",
    '  <section class="panel panel-details" aria-label="Details and issues">',
    '    <div class="detail-tabs" role="tablist" aria-label="Details">',
    '      <button type="button" id="tab-details" role="tab" aria-selected="true">Details</button>',
    '      <button type="button" id="tab-issues" role="tab" aria-selected="false">Issues <span id="issue-count" class="badge"></span></button>',
    "    </div>",
    '    <div id="details" class="details" role="tabpanel"></div>',
    '    <div id="issues" class="issues" role="tabpanel" hidden></div>',
    "  </section>",
    "</main>",
    `<script id="dli-data" type="application/json">${json}</script>`,
    `<script>${VIEWER_SCRIPT}</script>`,
    "</body>",
    "</html>",
  ].join("\n");
}

/**
 * Opens a file in the default browser without waiting for the process.
 * Never throws: failures come back as `{ opened: false, error }`.
 */
export async function openInBrowser(
  filePath: string,
  options: OpenBrowserOptions = {},
): Promise<OpenResult> {
  if (process.env.DLI_NO_OPEN === "1") {
    return { opened: false, error: "disabled by DLI_NO_OPEN=1" };
  }
  if (options.launcher) {
    try {
      await options.launcher(filePath);
      return { opened: true, browser: "custom" };
    } catch (error) {
      return { opened: false, error: errorMessage(error) };
    }
  }

  const url = pathToFileURL(filePath).href;
  let command: string;
  let args: string[];
  let browser: string;
  if (process.platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
    browser = "cmd";
  } else if (process.platform === "darwin") {
    command = "open";
    args = [url];
    browser = "open";
  } else if (process.platform === "linux") {
    command = "xdg-open";
    args = [url];
    browser = "xdg-open";
  } else {
    return { opened: false, error: `unsupported platform: ${process.platform}` };
  }

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    // Missing launchers emit an async "error"; the file is still written and
    // the caller reports the path, so swallow it rather than crash.
    child.once("error", () => undefined);
    child.unref();
    return { opened: true, browser };
  } catch (error) {
    return { opened: false, error: errorMessage(error) };
  }
}

function buildPayload(
  result: CaptureResult,
  options: {
    createdAt: string;
    title: string;
    maxNodes: number;
    includeProperties: boolean;
    screenshot: ViewerScreenshotPayload | null;
    issues: ViewerIssuesPayload | null;
  },
): ViewerPayload {
  const trees: Partial<Record<NodeSource, ViewerTreePayload>> = {};

  const addTree = (source: NodeSource, roots: UiNode[]) => {
    const totalNodes = flattenNodes(roots).length;
    const counter = { value: 0 };
    const serialized = roots.map((root) =>
      serializeNode(root, {
        maxNodes: options.maxNodes,
        counter,
        includeProps: options.includeProperties,
      }),
    );
    trees[source] = {
      source,
      roots: serialized,
      nodeCount: counter.value,
      totalNodes,
      truncated: totalNodes > counter.value,
    };
  };

  if (result.view) addTree("view", result.view.roots);
  if (result.semantics) addTree("semantics", result.semantics.roots);
  if (result.compose) addTree("compose", result.compose.roots);

  return {
    meta: {
      version: 1,
      createdAt: options.createdAt,
      title: options.title,
      device: {
        serial: result.device.serial,
        model: result.device.model,
        androidRelease: result.device.androidRelease,
        sdk: result.device.sdk,
      },
      target: {
        packageName: result.target.packageName,
        pid: result.target.pid,
        activity: result.target.activity,
        debuggable: result.target.debuggable,
        window: result.target.selectedWindow ?? null,
        windows: (result.target.windows ?? []).map((window) => window.name),
      },
      screen: result.screen,
      source: result.source,
      primarySource: result.source,
      sources: result.sources,
      uiKind: result.uiKind,
      warnings: result.warnings,
      limits: {
        maxNodes: options.maxNodes,
        includeProperties: options.includeProperties,
        budgetBytes: VIEWER_BUDGET_BYTES,
        budgetExceeded: false,
      },
    },
    trees,
    screenshot: options.screenshot,
    issues: options.issues,
  };
}

function screenshotPayload(screenshot: Screenshot, screen: ScreenInfo): ViewerScreenshotPayload {
  const factorX = screenshot.width > 0 ? screen.width / screenshot.width : 1;
  const factorY = screenshot.height > 0 ? screen.height / screenshot.height : 1;
  return {
    dataUri: `data:image/png;base64,${screenshot.buffer.toString("base64")}`,
    width: screenshot.width,
    height: screenshot.height,
    originalWidth: screenshot.originalWidth,
    originalHeight: screenshot.originalHeight,
    scale: screenshot.scale,
    imageToDevice: {
      x: Math.round(factorX * 1000) / 1000,
      y: Math.round(factorY * 1000) / 1000,
    },
  };
}

function payloadBytes(payload: ViewerPayload): number {
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}

function defaultTitle(result: CaptureResult): string {
  const packageName = result.target.packageName;
  return packageName ? `${packageName} UI viewer` : "UI viewer";
}

/**
 * Embedding JSON in a `<script>` block: `<` must not appear, or captured text
 * like `</script><script>…` would close the block. U+2028/U+2029 are escaped
 * too because they are valid JSON but line terminators in pre-ES2019 scripts.
 */
function escapeForScript(json: string): string {
  return json
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; " +
  "script-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'";

const VIEWER_CSS = String.raw`
:root { color-scheme: dark; }
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 13px;
  background: #0f1116;
  color: #e6e9ef;
}
[hidden] { display: none !important; }
button, input { font: inherit; }
button {
  background: #232936;
  color: #e6e9ef;
  border: 1px solid #333b4b;
  border-radius: 6px;
  padding: 3px 9px;
  cursor: pointer;
}
button:hover { background: #2c3444; }
button:focus-visible, input:focus-visible, .row:focus-visible { outline: 2px solid #5ec8ff; outline-offset: 1px; }
#app-header { padding: 10px 14px 8px; border-bottom: 1px solid #262b36; background: #141821; }
.header-top { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
h1 { font-size: 15px; margin: 0; font-weight: 600; }
.meta-line { color: #9aa4b2; margin-top: 5px; font-size: 12px; line-height: 1.5; }
.warnings { color: #ffd166; margin-top: 5px; font-size: 12px; }
.legend { display: flex; gap: 12px; flex-wrap: wrap; color: #9aa4b2; font-size: 11px; }
.legend-item { display: inline-flex; align-items: center; gap: 4px; }
.swatch { width: 12px; height: 8px; border: 1px solid #5ec8ff; display: inline-block; }
.swatch.click { border-color: #ff3b6b; }
.swatch.selected { border-color: #ffd166; border-width: 2px; }
.swatch.issue { border-color: #ffd166; border-style: dashed; }
.swatch.raw { border-color: #8b93a7; border-style: dashed; }
main {
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr) 360px;
  gap: 10px;
  padding: 10px;
  height: calc(100vh - 92px);
  min-height: 0;
}
.panel {
  background: #171a21;
  border: 1px solid #262b36;
  border-radius: 10px;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.panel-toolbar { padding: 8px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; border-bottom: 1px solid #232936; }
.panel-toolbar input[type="search"] {
  flex: 1 1 100%;
  min-width: 0;
  background: #0f1116;
  color: #e6e9ef;
  border: 1px solid #333b4b;
  border-radius: 6px;
  padding: 5px 8px;
}
.match-count { color: #8b93a7; font-size: 11px; min-width: 32px; }
.filters { display: flex; gap: 10px; flex-wrap: wrap; }
.check { color: #9aa4b2; display: inline-flex; align-items: center; gap: 4px; }
.tree-actions { display: flex; gap: 4px; margin-left: auto; }
.source-tabs { display: flex; gap: 4px; padding: 6px 8px; border-bottom: 1px solid #232936; flex-wrap: wrap; }
.source-tab {
  background: transparent;
  border: 1px solid #333b4b;
  border-radius: 999px;
  padding: 2px 10px;
  color: #9aa4b2;
}
.source-tab[aria-selected="true"] { background: #243247; border-color: #5ec8ff; color: #e6e9ef; }
.tree { overflow: auto; flex: 1; padding: 4px 0 12px; min-height: 0; }
.tree ul { list-style: none; margin: 0; padding-left: 13px; }
.tree > ul { padding-left: 2px; }
.tree-item.filtered-out { display: none; }
.row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 6px 2px 2px;
  border-left: 2px solid transparent;
  cursor: pointer;
  outline: none;
  border-radius: 3px;
}
.row:hover { background: #202633; }
.row.selected { background: #2a2410; border-left-color: #ffd166; }
.row.match { background: #132b3d; }
.row.match.selected { background: #2a2410; }
.row.invisible { opacity: .55; }
.toggle {
  width: 18px;
  min-width: 18px;
  height: 18px;
  padding: 0;
  line-height: 1;
  background: transparent;
  border: 0;
  color: #8b93a7;
  border-radius: 3px;
  font-size: 11px;
}
.toggle.leaf { cursor: default; color: #4b5566; }
.ref { color: #9aa4b2; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; min-width: 30px; }
.row.clickable .ref { color: #ff3b6b; }
.cls { color: #c792ea; font-size: 11px; white-space: nowrap; }
.row.compose-node .cls { color: #8be9a8; }
.lbl { color: #e6e9ef; overflow: hidden; text-overflow: ellipsis; max-width: 150px; white-space: nowrap; }
.bnd { color: #6b7484; margin-left: auto; font-size: 10px; white-space: nowrap; }
.stage-wrap {
  position: relative;
  flex: 1;
  overflow: hidden;
  background: #0b0d12;
  min-height: 0;
  display: block;
  touch-action: none;
  cursor: grab;
}
.stage-wrap:active { cursor: grabbing; }
.stage { position: absolute; top: 0; left: 0; transform-origin: 0 0; box-shadow: 0 0 0 1px #2a3040; }
#shot { display: block; width: 100%; height: 100%; user-select: none; -webkit-user-drag: none; }
.overlay { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.no-shot {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  color: #ffd166;
  background: repeating-linear-gradient(45deg, #141821, #141821 10px, #171c25 10px, #171c25 20px);
  font-size: 14px;
}
.stage-bar { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-top: 1px solid #232936; flex-wrap: wrap; }
.zoom-label { color: #9aa4b2; font-size: 11px; min-width: 38px; }
.coord-readout { color: #8b93a7; font-size: 11px; margin-left: auto; }
.box { fill: transparent; stroke: #5ec8ff; stroke-width: 1; vector-effect: non-scaling-stroke; pointer-events: all; }
.box.click { stroke: #ff3b6b; }
.box.label { stroke: #5ec8ff; }
.box.issue { stroke: #ffd166; stroke-dasharray: 4 3; }
.box.raw { stroke: #8b93a7; stroke-dasharray: 2 3; pointer-events: none; }
.box.hover { stroke-width: 2.5; }
.box.selected { stroke: #ffd166; stroke-width: 2.5; }
.overlay-label {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  fill: #ffd166;
  stroke: #000;
  stroke-width: 3;
  paint-order: stroke;
  pointer-events: none;
}
.overlay-label.issue-label { fill: #ffd166; }
.detail-tabs { display: flex; gap: 4px; padding: 8px 8px 0; border-bottom: 1px solid #232936; }
.detail-tabs button {
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  color: #9aa4b2;
  padding: 5px 9px;
}
.detail-tabs button[aria-selected="true"] { color: #e6e9ef; border-bottom-color: #5ec8ff; }
.badge { color: #ffd166; }
.details, .issues { overflow: auto; flex: 1; padding: 10px; min-height: 0; }
.detail-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.detail-ref { color: #ffd166; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.detail-class { color: #c792ea; word-break: break-all; }
.field { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 6px; padding: 3px 0; border-bottom: 1px solid #1e232d; }
.field-label { color: #8b93a7; font-size: 11px; }
.field-value { color: #e6e9ef; word-break: break-word; white-space: pre-wrap; }
.section-title { color: #5ec8ff; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; margin: 14px 0 4px; }
.muted { color: #8b93a7; }
.issue-group { color: #9aa4b2; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; margin: 10px 0 5px; }
.issue-row {
  display: block;
  width: 100%;
  text-align: left;
  background: #141821;
  border: 1px solid #2a3040;
  border-left: 3px solid #ffd166;
  border-radius: 6px;
  padding: 6px 8px;
  margin-bottom: 6px;
  cursor: pointer;
}
.issue-row.warning { border-left-color: #ff9f43; }
.issue-row.info { border-left-color: #5ec8ff; }
.issue-row:hover { background: #1c212b; }
.issue-top { display: flex; gap: 8px; align-items: baseline; margin-bottom: 3px; }
.issue-rule { color: #ffd166; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; }
.issue-ref { color: #9aa4b2; font-size: 11px; }
.issue-message { color: #cfd5df; font-size: 12px; }
@media (max-width: 1100px) {
  body { overflow: auto; }
  main { grid-template-columns: 1fr; height: auto; }
  .panel-tree { max-height: 45vh; }
  .panel-stage { height: 60vh; }
  .panel-details { max-height: 60vh; }
}
`;

const VIEWER_SCRIPT = String.raw`
(function () {
  "use strict";
  var dataEl = document.getElementById("dli-data");
  var payload = JSON.parse(dataEl.textContent);
  var meta = payload.meta || {};
  var trees = payload.trees || {};
  var sourceNames = Object.keys(trees);
  var activeSource = trees[meta.primarySource] ? meta.primarySource : sourceNames[0];
  var screen = meta.screen || { width: 1080, height: 2400 };
  var SVG_NS = "http:" + "//www.w3.org/2000/svg";

  var collapsed = Object.create(null);
  var nodeByKey = Object.create(null);
  var parentByKey = Object.create(null);
  var elByKey = Object.create(null);
  var rectByKey = Object.create(null);
  var issueKeys = Object.create(null);
  var selectedKey = null;
  var hoverKey = null;
  var query = "";
  var matches = [];
  var matchIndex = -1;
  var clickableOnly = false;
  var visibleOnly = true;
  var zoom = 1;
  var panX = 0;
  var panY = 0;
  var dragging = false;
  var dragOrigin = null;
  var overlayLabel = null;

  function byId(id) { return document.getElementById(id); }
  function clearChildren(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function keyOf(source, node) { return source + "|" + node.id; }
  function childrenOf(node) { return Array.isArray(node.children) ? node.children : []; }
  function shortName(name) {
    if (!name) return "";
    var parts = String(name).split(".");
    return parts[parts.length - 1];
  }
  function labelOf(node) {
    if (node.text) return node.text;
    if (node.contentDescription) return node.contentDescription;
    if (node.resourceId) return node.resourceId;
    if (node.compose && node.compose.name) return node.compose.name;
    return shortName(node.className);
  }
  function trimText(value, max) {
    var text = String(value);
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
  }
  function boundsText(b) {
    if (!b) return "none";
    return "[" + b.left + "," + b.top + "][" + b.right + "," + b.bottom + "] " + b.width + "x" + b.height;
  }
  function svgEl(name) { return document.createElementNS(SVG_NS, name); }
  function span(className, text) {
    var el = document.createElement("span");
    el.className = className;
    el.textContent = text;
    return el;
  }
  function objectText(value) {
    if (!value || typeof value !== "object") return value === undefined || value === null ? null : String(value);
    var parts = [];
    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i++) {
      var item = value[keys[i]];
      parts.push(keys[i] + "=" + (item && typeof item === "object" ? "(" + objectText(item) + ")" : String(item)));
    }
    return parts.join(", ");
  }

  function initHeader() {
    if (meta.title) document.title = meta.title;
    byId("app-title").textContent = meta.title || "UI viewer";
    var parts = [];
    if (meta.device) {
      parts.push("device " + (meta.device.model || meta.device.serial || "?"));
      if (meta.device.serial) parts.push("serial " + meta.device.serial);
      if (meta.device.androidRelease) parts.push("android " + meta.device.androidRelease);
    }
    if (meta.target) {
      parts.push("package " + (meta.target.packageName || "?") + (meta.target.activity ? " / " + meta.target.activity : ""));
    }
    if (screen) parts.push("screen " + screen.width + "x" + screen.height + " @ " + screen.density + "x");
    parts.push("uiKind " + (meta.uiKind || "unknown"));
    parts.push("captured " + (meta.createdAt || ""));
    byId("meta-line").textContent = parts.join("  ·  ");
    var warningsEl = byId("warnings");
    if (meta.warnings && meta.warnings.length) {
      warningsEl.hidden = false;
      warningsEl.textContent = "Warnings: " + meta.warnings.join(" | ");
    } else {
      warningsEl.hidden = true;
    }
    var issueCount = payload.issues && payload.issues.issues ? payload.issues.issues.length : 0;
    byId("issue-count").textContent = payload.issues ? String(issueCount) : "";
  }

  function renderSourceTabs() {
    var tabs = byId("source-tabs");
    clearChildren(tabs);
    for (var i = 0; i < sourceNames.length; i++) {
      (function (source) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "source-tab";
        button.textContent = source;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(source === activeSource));
        button.addEventListener("click", function () {
          if (source !== activeSource) switchSource(source);
        });
        tabs.appendChild(button);
      })(sourceNames[i]);
    }
  }

  function collectIssues() {
    issueKeys = Object.create(null);
    if (!payload.issues || !payload.issues.issues) return;
    for (var i = 0; i < payload.issues.issues.length; i++) {
      var issue = payload.issues.issues[i];
      issueKeys[issue.source + "|" + issue.nodeId] = true;
    }
  }

  function indexTree(source, roots) {
    function walk(list, parentKey) {
      for (var i = 0; i < list.length; i++) {
        var node = list[i];
        var key = keyOf(source, node);
        nodeByKey[key] = node;
        parentByKey[key] = parentKey;
        walk(childrenOf(node), key);
      }
    }
    walk(roots, null);
  }

  function setCollapsed(key, value) {
    collapsed[key] = value;
    var entry = elByKey[key];
    if (!entry) return;
    entry.toggle.textContent = value ? "▸" : "▾";
    entry.childrenUl.hidden = value;
    entry.li.setAttribute("aria-expanded", String(!value));
  }

  function buildTree() {
    var treeEl = byId("tree");
    clearChildren(treeEl);
    elByKey = Object.create(null);
    nodeByKey = Object.create(null);
    parentByKey = Object.create(null);
    rectByKey = Object.create(null);
    var tree = trees[activeSource];
    if (!tree) return;
    indexTree(activeSource, tree.roots || []);
    var root = document.createElement("ul");
    root.setAttribute("role", "group");
    for (var i = 0; i < (tree.roots || []).length; i++) {
      root.appendChild(buildLi(tree.roots[i], 1));
    }
    treeEl.appendChild(root);
    applyFilters();
  }

  function buildLi(node, level) {
    var key = keyOf(activeSource, node);
    var children = childrenOf(node);
    var li = document.createElement("li");
    li.className = "tree-item";
    li.setAttribute("role", "treeitem");
    li.setAttribute("aria-level", String(level));
    li.setAttribute("aria-selected", "false");
    if (children.length) li.setAttribute("aria-expanded", String(!collapsed[key]));

    var row = document.createElement("div");
    row.className = "row";
    row.tabIndex = -1;
    row.dataset.key = key;
    row.dataset.id = node.id;
    if (node.visible === false) row.classList.add("invisible");
    if (node.clickable) row.classList.add("clickable");
    if (node.compose) row.classList.add("compose-node");
    row.title = (node.className || "") + " " + (node.ref || "");

    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "toggle";
    if (children.length) {
      toggle.textContent = collapsed[key] ? "▸" : "▾";
      toggle.setAttribute("aria-label", "Toggle children of " + (node.ref || node.id));
      toggle.addEventListener("click", function (event) {
        event.stopPropagation();
        setCollapsed(key, !collapsed[key]);
      });
    } else {
      toggle.textContent = "·";
      toggle.className = "toggle leaf";
      toggle.disabled = true;
    }
    row.appendChild(toggle);
    row.appendChild(span("ref", node.ref || ""));
    row.appendChild(span("cls", shortName(node.className)));
    var label = labelOf(node);
    if (label) row.appendChild(span("lbl", trimText(label, 80)));
    row.appendChild(span("bnd", (node.bounds ? node.bounds.width + "x" + node.bounds.height : "")));
    row.addEventListener("click", function () { selectNode(activeSource, node.id, true); });
    row.addEventListener("mouseenter", function () { hoverNode(key); });
    row.addEventListener("mouseleave", function () { hoverNode(null); });

    var childUl = document.createElement("ul");
    childUl.setAttribute("role", "group");
    childUl.className = "children";
    childUl.hidden = collapsed[key] === true;
    for (var i = 0; i < children.length; i++) {
      childUl.appendChild(buildLi(children[i], level + 1));
    }

    li.appendChild(row);
    li.appendChild(childUl);
    elByKey[key] = { row: row, li: li, toggle: toggle, childrenUl: childUl, node: node };
    return li;
  }

  function matchesQuery(node) {
    if (!query) return false;
    var needle = query.toLowerCase();
    var fields = [node.ref, node.id, node.className, node.resourceId, node.text, node.contentDescription];
    if (node.compose) fields.push(node.compose.name, node.compose.fileName);
    for (var i = 0; i < fields.length; i++) {
      if (fields[i] !== null && fields[i] !== undefined && String(fields[i]).toLowerCase().indexOf(needle) >= 0) {
        return true;
      }
    }
    return false;
  }

  function passesFilter(node) {
    if (clickableOnly && !node.clickable) return false;
    if (visibleOnly && node.visible === false) return false;
    return true;
  }

  function applyFilters() {
    matches = [];
    matchIndex = -1;
    var tree = trees[activeSource];
    if (!tree) return;
    function visit(node) {
      var key = keyOf(activeSource, node);
      var self = passesFilter(node) && (query ? matchesQuery(node) : true);
      if (query && self) matches.push(node);
      var children = childrenOf(node);
      var childShown = false;
      for (var i = 0; i < children.length; i++) {
        if (visit(children[i])) childShown = true;
      }
      var show = self || childShown || key === selectedKey;
      var entry = elByKey[key];
      if (entry) {
        entry.li.classList.toggle("filtered-out", !show);
        entry.row.classList.toggle("match", Boolean(query) && self);
      }
      return show;
    }
    var roots = tree.roots || [];
    for (var i = 0; i < roots.length; i++) visit(roots[i]);
    updateMatchCount();
  }

  function updateMatchCount() {
    var el = byId("match-count");
    if (!query) {
      el.textContent = "";
    } else if (matchIndex >= 0) {
      el.textContent = (matchIndex + 1) + "/" + matches.length;
    } else {
      el.textContent = matches.length + (matches.length === 1 ? " match" : " matches");
    }
  }

  function cycleMatch(direction) {
    if (!matches.length) return;
    matchIndex = (matchIndex + direction + matches.length) % matches.length;
    updateMatchCount();
    selectNode(activeSource, matches[matchIndex].id, true);
  }

  function switchSource(source) {
    if (!trees[source]) return;
    activeSource = source;
    selectedKey = null;
    hoverKey = null;
    renderSourceTabs();
    buildTree();
    renderOverlay();
    renderDetails(null);
  }

  function selectNode(source, id, scroll) {
    if (!trees[source]) return;
    if (source !== activeSource) switchSource(source);
    var key = source + "|" + id;
    var entry = elByKey[key];
    if (!entry) return;
    var parent = parentByKey[key];
    while (parent) {
      if (collapsed[parent]) setCollapsed(parent, false);
      parent = parentByKey[parent];
    }
    var previous = document.querySelectorAll("#tree .row.selected");
    for (var i = 0; i < previous.length; i++) {
      previous[i].classList.remove("selected");
      previous[i].setAttribute("aria-selected", "false");
    }
    selectedKey = key;
    entry.row.classList.add("selected");
    entry.row.setAttribute("aria-selected", "true");
    entry.li.classList.remove("filtered-out");
    var visibleParent = parentByKey[key];
    while (visibleParent) {
      if (elByKey[visibleParent]) elByKey[visibleParent].li.classList.remove("filtered-out");
      visibleParent = parentByKey[visibleParent];
    }
    if (scroll && entry.row.scrollIntoView) entry.row.scrollIntoView({ block: "nearest" });
    updateSelectionOverlay();
    renderDetails(entry.node);
  }

  function clearSelection() {
    selectedKey = null;
    var selected = document.querySelectorAll("#tree .row.selected");
    for (var i = 0; i < selected.length; i++) {
      selected[i].classList.remove("selected");
      selected[i].setAttribute("aria-selected", "false");
    }
    for (var key in rectByKey) rectByKey[key].visible.classList.remove("selected");
    hideOverlayLabel();
    renderDetails(null);
  }

  function hoverNode(key) {
    if (hoverKey && rectByKey[hoverKey]) {
      rectByKey[hoverKey].visible.classList.remove("hover");
      if (rectByKey[hoverKey].raw) rectByKey[hoverKey].raw.classList.remove("hover");
    }
    hoverKey = key;
    if (key && rectByKey[key]) {
      rectByKey[key].visible.classList.add("hover");
      if (rectByKey[key].raw) rectByKey[key].raw.classList.add("hover");
    }
    if (key && nodeByKey[key]) {
      showOverlayLabel(nodeByKey[key]);
    } else if (selectedKey && nodeByKey[selectedKey]) {
      showOverlayLabel(nodeByKey[selectedKey]);
    } else {
      hideOverlayLabel();
    }
  }

  function screenshotDims() {
    var shot = payload.screenshot;
    var width = shot ? shot.width : screen.width;
    var height = shot ? shot.height : screen.height;
    return {
      shot: shot,
      width: width,
      height: height,
      sx: screen.width > 0 ? width / screen.width : 1,
      sy: screen.height > 0 ? height / screen.height : 1
    };
  }

  function renderOverlay() {
    var overlay = byId("overlay");
    clearChildren(overlay);
    rectByKey = Object.create(null);
    overlayLabel = null;
    var dims = screenshotDims();
    overlay.setAttribute("viewBox", "0 0 " + dims.width + " " + dims.height);
    overlay.setAttribute("width", String(dims.width));
    overlay.setAttribute("height", String(dims.height));
    if (!dims.shot) {
      overlay.setAttribute("hidden", "");
      return;
    }
    overlay.removeAttribute("hidden");
    var tree = trees[activeSource];
    if (!tree) return;
    var labelCount = 0;

    function addBox(node, bounds, className) {
      var rect = svgEl("rect");
      rect.setAttribute("x", String(bounds.left * dims.sx));
      rect.setAttribute("y", String(bounds.top * dims.sy));
      rect.setAttribute("width", String(Math.max(1, bounds.width * dims.sx)));
      rect.setAttribute("height", String(Math.max(1, bounds.height * dims.sy)));
      rect.setAttribute("class", className);
      return rect;
    }

    function addLabel(node, bounds) {
      if (labelCount >= 40) return;
      var text = svgEl("text");
      text.setAttribute("x", String(bounds.left * dims.sx + 2));
      text.setAttribute("y", String(Math.max(11, bounds.top * dims.sy - 3)));
      text.setAttribute("class", "overlay-label issue-label");
      text.textContent = (node.ref || "") + " " + shortName(node.className);
      overlay.appendChild(text);
      labelCount += 1;
    }

    function walk(node) {
      var key = keyOf(activeSource, node);
      var isIssue = issueKeys[key] === true;
      var isSelected = key === selectedKey;
      var bounds = node.visibleBounds || node.bounds;
      if (bounds && (!visibleOnly || node.visible !== false || isIssue || isSelected) &&
          (!clickableOnly || node.clickable || isIssue || isSelected)) {
        var className = "box";
        if (node.clickable) className += " click";
        else if (labelOf(node)) className += " label";
        if (isIssue) className += " issue";
        if (isSelected) className += " selected";
        var rect = addBox(node, bounds, className);
        rect.setAttribute("data-key", key);
        (function (nodeKey, nodeId) {
          rect.addEventListener("click", function (event) {
            event.stopPropagation();
            selectNode(activeSource, nodeId, true);
          });
          rect.addEventListener("mouseenter", function () { hoverNode(nodeKey); });
          rect.addEventListener("mouseleave", function () { hoverNode(null); });
        })(key, node.id);
        overlay.appendChild(rect);
        var entry = { visible: rect, raw: null };
        var raw = node.bounds;
        if (node.visibleBounds && raw &&
            (raw.left !== node.visibleBounds.left || raw.top !== node.visibleBounds.top ||
             raw.right !== node.visibleBounds.right || raw.bottom !== node.visibleBounds.bottom)) {
          var rawRect = addBox(node, raw, "box raw");
          overlay.appendChild(rawRect);
          entry.raw = rawRect;
        }
        rectByKey[key] = entry;
        if (isIssue) addLabel(node, bounds);
        if (isSelected) showOverlayLabel(node);
      }
      var children = childrenOf(node);
      for (var i = 0; i < children.length; i++) walk(children[i]);
    }

    var roots = tree.roots || [];
    for (var i = 0; i < roots.length; i++) walk(roots[i]);

    overlayLabel = svgEl("text");
    overlayLabel.setAttribute("class", "overlay-label");
    overlayLabel.style.display = "none";
    overlay.appendChild(overlayLabel);
  }

  function showOverlayLabel(node) {
    if (!overlayLabel || !payload.screenshot) return;
    var bounds = node.visibleBounds || node.bounds;
    if (!bounds) {
      hideOverlayLabel();
      return;
    }
    var dims = screenshotDims();
    var label = labelOf(node);
    overlayLabel.setAttribute("x", String(bounds.left * dims.sx + 2));
    overlayLabel.setAttribute("y", String(Math.max(11, bounds.top * dims.sy - 3)));
    overlayLabel.textContent = (node.ref || "") + " " + shortName(node.className) +
      (label && label !== shortName(node.className) ? " " + trimText(label, 44) : "");
    overlayLabel.style.display = "";
  }

  function hideOverlayLabel() {
    if (overlayLabel) overlayLabel.style.display = "none";
  }

  function updateSelectionOverlay() {
    for (var key in rectByKey) {
      rectByKey[key].visible.classList.toggle("selected", key === selectedKey);
    }
    if (selectedKey && nodeByKey[selectedKey]) {
      showOverlayLabel(nodeByKey[selectedKey]);
    } else {
      hideOverlayLabel();
    }
  }

  function flagsOf(node) {
    var flags = [];
    if (node.clickable) flags.push("clickable");
    if (node.longClickable) flags.push("longClickable");
    if (node.focusable) flags.push("focusable");
    if (node.focused) flags.push("focused");
    if (node.scrollable) flags.push("scrollable");
    if (node.checkable) flags.push("checkable");
    if (node.checked) flags.push("checked");
    if (node.selected) flags.push("selected");
    if (node.password) flags.push("password");
    if (node.visible === false) flags.push("invisible");
    if (node.enabled === false) flags.push("disabled");
    return flags.join(", ");
  }

  function addField(panel, label, value) {
    if (value === null || value === undefined || value === "") return;
    var row = document.createElement("div");
    row.className = "field";
    var name = document.createElement("div");
    name.className = "field-label";
    name.textContent = label;
    var val = document.createElement("div");
    val.className = "field-value";
    val.textContent = String(value);
    row.appendChild(name);
    row.appendChild(val);
    panel.appendChild(row);
  }

  function addSection(panel, title) {
    var heading = document.createElement("div");
    heading.className = "section-title";
    heading.textContent = title;
    panel.appendChild(heading);
  }

  function renderDetails(node) {
    var panel = byId("details");
    clearChildren(panel);
    if (!node) {
      var hint = document.createElement("p");
      hint.className = "muted";
      hint.textContent = "Select a node in the tree, on the screenshot, or from an issue.";
      panel.appendChild(hint);
      return;
    }
    var head = document.createElement("div");
    head.className = "detail-head";
    head.appendChild(span("detail-ref", node.ref || ""));
    head.appendChild(span("detail-class", node.className || ""));
    panel.appendChild(head);
    addField(panel, "id", node.id);
    addField(panel, "resource id", node.resourceId);
    addField(panel, "text", node.text);
    addField(panel, "content desc", node.contentDescription);
    addField(panel, "bounds", boundsText(node.bounds));
    addField(panel, "visible bounds", boundsText(node.visibleBounds));
    addField(panel, "center", node.center ? node.center.x + ", " + node.center.y : null);
    addField(panel, "visible", node.visible === undefined ? null : String(node.visible));
    addField(panel, "enabled", node.enabled === undefined ? null : String(node.enabled));
    addField(panel, "flags", flagsOf(node));

    if (node.compose) {
      addSection(panel, "Compose");
      addField(panel, "name", node.compose.name);
      addField(panel, "file:line", (node.compose.fileName || "?") + ":" + node.compose.lineNumber);
      addField(panel, "recomposed", String(node.compose.recomposeCount) + " (skips " + String(node.compose.recomposeSkips) + ")");
      addField(panel, "compose flags", (node.compose.flags || []).join(", "));
    }
    if (node.view) {
      addSection(panel, "View");
      addField(panel, "visibility", node.view.visibility);
      addField(panel, "alpha", node.view.alpha);
      addField(panel, "elevation", node.view.elevation);
      addField(panel, "scroll", node.view.scrollX + ", " + node.view.scrollY);
      addField(panel, "translation", node.view.translationX + ", " + node.view.translationY);
      addField(panel, "scale", node.view.scaleX + ", " + node.view.scaleY);
      addField(panel, "padding", objectText(node.view.padding));
      if (node.view.layoutParams) {
        addField(panel, "layout w/h", objectText({ width: node.view.layoutParams.width, height: node.view.layoutParams.height }));
        addField(panel, "margins", objectText(node.view.layoutParams.margins));
      }
      if (node.view.properties) {
        addSection(panel, "Raw properties");
        var propKeys = Object.keys(node.view.properties);
        for (var i = 0; i < propKeys.length; i++) {
          addField(panel, propKeys[i], objectText(node.view.properties[propKeys[i]]));
        }
      }
    }
    if (node.attributes) {
      addSection(panel, "Attributes");
      var attrKeys = Object.keys(node.attributes);
      for (var j = 0; j < attrKeys.length; j++) {
        addField(panel, attrKeys[j], node.attributes[attrKeys[j]]);
      }
    }
  }

  function renderIssues() {
    var panel = byId("issues");
    clearChildren(panel);
    var data = payload.issues;
    if (!data) {
      var none = document.createElement("p");
      none.className = "muted";
      none.textContent = "Analysis was not included in this viewer.";
      panel.appendChild(none);
      return;
    }
    var list = data.issues || [];
    if (!list.length) {
      var clean = document.createElement("p");
      clean.className = "muted";
      clean.textContent = "No issues detected.";
      panel.appendChild(clean);
    }
    var groups = [["error", "Errors"], ["warning", "Warnings"], ["info", "Info"]];
    for (var g = 0; g < groups.length; g++) {
      var items = [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].severity === groups[g][0]) items.push(list[i]);
      }
      if (!items.length) continue;
      var heading = document.createElement("div");
      heading.className = "issue-group";
      heading.textContent = groups[g][1] + " (" + items.length + ")";
      panel.appendChild(heading);
      for (var j = 0; j < items.length; j++) {
        (function (issue) {
          var button = document.createElement("button");
          button.type = "button";
          button.className = "issue-row " + issue.severity;
          var top = document.createElement("div");
          top.className = "issue-top";
          top.appendChild(span("issue-rule", issue.rule));
          top.appendChild(span("issue-ref", issue.ref || ""));
          button.appendChild(top);
          var message = document.createElement("div");
          message.className = "issue-message";
          message.textContent = issue.message || "";
          button.appendChild(message);
          button.addEventListener("click", function () {
            showTab("issues");
            selectNode(issue.source, issue.nodeId, true);
          });
          panel.appendChild(button);
        })(items[j]);
      }
    }
    var footer = document.createElement("div");
    footer.className = "muted";
    footer.textContent = "dp=" + data.dp + " · nodes=" + data.nodeCount;
    panel.appendChild(footer);
  }

  function showTab(name) {
    byId("details").hidden = name !== "details";
    byId("issues").hidden = name !== "issues";
    byId("tab-details").setAttribute("aria-selected", String(name === "details"));
    byId("tab-issues").setAttribute("aria-selected", String(name === "issues"));
  }

  function applyTransform() {
    var stage = byId("stage");
    stage.style.transform = "translate(" + panX + "px," + panY + "px) scale(" + zoom + ")";
    byId("zoom-label").textContent = Math.round(zoom * 100) + "%";
  }

  function setZoom(value) {
    zoom = Math.max(0.1, Math.min(8, value));
    applyTransform();
  }

  function fit() {
    var wrap = byId("stage-wrap");
    var dims = screenshotDims();
    var availableWidth = wrap.clientWidth - 24;
    var availableHeight = wrap.clientHeight - 24;
    if (availableWidth <= 0 || availableHeight <= 0) return;
    zoom = Math.max(0.1, Math.min(1, availableWidth / dims.width, availableHeight / dims.height));
    panX = Math.max(0, (wrap.clientWidth - dims.width * zoom) / 2);
    panY = Math.max(0, (wrap.clientHeight - dims.height * zoom) / 2);
    applyTransform();
  }

  function initStage() {
    var dims = screenshotDims();
    var stage = byId("stage");
    var image = byId("shot");
    var noShot = byId("no-shot");
    stage.style.width = dims.width + "px";
    stage.style.height = dims.height + "px";
    if (dims.shot) {
      image.hidden = false;
      image.src = dims.shot.dataUri;
      image.width = dims.width;
      image.height = dims.height;
      noShot.hidden = true;
    } else {
      image.hidden = true;
      noShot.hidden = false;
      noShot.textContent = "Screenshot unavailable — showing the node tree, details, and issues only.";
    }
    applyTransform();
  }

  function initStageEvents() {
    var wrap = byId("stage-wrap");
    byId("zoom-in").addEventListener("click", function () { setZoom(zoom * 1.2); });
    byId("zoom-out").addEventListener("click", function () { setZoom(zoom / 1.2); });
    byId("fit").addEventListener("click", fit);
    wrap.addEventListener("wheel", function (event) {
      if (!payload.screenshot) return;
      event.preventDefault();
      setZoom(zoom * (event.deltaY < 0 ? 1.1 : 0.9));
    }, { passive: false });
    wrap.addEventListener("pointerdown", function (event) {
      if (event.button !== 0 || !payload.screenshot) return;
      dragging = true;
      dragOrigin = { x: event.clientX - panX, y: event.clientY - panY };
      if (wrap.setPointerCapture) wrap.setPointerCapture(event.pointerId);
    });
    wrap.addEventListener("pointermove", function (event) {
      var rect = byId("stage").getBoundingClientRect();
      var imageX = (event.clientX - rect.left) / zoom;
      var imageY = (event.clientY - rect.top) / zoom;
      var dims = screenshotDims();
      var deviceX = Math.round(imageX * screen.width / dims.width);
      var deviceY = Math.round(imageY * screen.height / dims.height);
      byId("coord-readout").textContent = payload.screenshot
        ? "image (" + Math.round(imageX) + ", " + Math.round(imageY) + ") · device (" + deviceX + ", " + deviceY + ")"
        : "device (" + deviceX + ", " + deviceY + ")";
      if (dragging && dragOrigin) {
        panX = event.clientX - dragOrigin.x;
        panY = event.clientY - dragOrigin.y;
        applyTransform();
      }
    });
    wrap.addEventListener("pointerup", function () { dragging = false; });
    wrap.addEventListener("pointerleave", function () {
      dragging = false;
      byId("coord-readout").textContent = "";
    });
  }

  function visibleRows() {
    var rows = document.querySelectorAll("#tree .row");
    var result = [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].offsetParent !== null) result.push(rows[i]);
    }
    return result;
  }

  function moveSelection(direction) {
    var rows = visibleRows();
    if (!rows.length) return;
    var index = -1;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].classList.contains("selected")) index = i;
    }
    var next = index < 0
      ? (direction > 0 ? 0 : rows.length - 1)
      : Math.max(0, Math.min(rows.length - 1, index + direction));
    var node = nodeByKey[rows[next].dataset.key];
    if (node) selectNode(activeSource, node.id, true);
  }

  function initEvents() {
    var search = byId("search");
    search.addEventListener("input", function () {
      query = search.value.trim();
      applyFilters();
    });
    search.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        cycleMatch(event.shiftKey ? -1 : 1);
      } else if (event.key === "Escape") {
        search.value = "";
        query = "";
        applyFilters();
        search.blur();
      }
    });
    byId("clickable-only").addEventListener("change", function (event) {
      clickableOnly = event.target.checked;
      applyFilters();
      renderOverlay();
    });
    byId("visible-only").addEventListener("change", function (event) {
      visibleOnly = event.target.checked;
      applyFilters();
      renderOverlay();
    });
    byId("expand-all").addEventListener("click", function () {
      for (var key in elByKey) {
        if (elByKey[key].childrenUl.firstChild) setCollapsed(key, false);
      }
    });
    byId("collapse-all").addEventListener("click", function () {
      for (var key in elByKey) {
        if (elByKey[key].childrenUl.firstChild) setCollapsed(key, true);
      }
    });
    byId("tab-details").addEventListener("click", function () { showTab("details"); });
    byId("tab-issues").addEventListener("click", function () { showTab("issues"); });
    document.addEventListener("keydown", function (event) {
      var tag = (event.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (event.key === "/") {
        event.preventDefault();
        search.focus();
      } else if (event.key === "Escape") {
        clearSelection();
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setZoom(zoom * 1.2);
      } else if (event.key === "-") {
        event.preventDefault();
        setZoom(zoom / 1.2);
      } else if (event.key === "f" || event.key === "F") {
        fit();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        moveSelection(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(-1);
      } else if (event.key === "Enter" && query) {
        event.preventDefault();
        cycleMatch(1);
      }
    });
    window.addEventListener("resize", fit);
  }

  initHeader();
  collectIssues();
  initStage();
  renderSourceTabs();
  buildTree();
  renderOverlay();
  renderIssues();
  renderDetails(null);
  showTab("details");
  initStageEvents();
  initEvents();
  window.setTimeout(fit, 0);
})();
`;