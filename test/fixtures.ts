import { readFileSync } from "node:fs";
import type { Bounds, CaptureResult, ScreenInfo, UiNode } from "../src/core/model.js";
import { parseSemanticsXml } from "../src/core/semantics.js";
import { parseViewHierarchy } from "../src/core/viewdump.js";

export const SCREEN: ScreenInfo = {
  width: 1080,
  height: 2400,
  density: 2.75,
  densityDpi: 440,
  orientation: "portrait",
  rotation: 0,
};

export function loadFixtureCapture(): CaptureResult {
  const viewBytes = readFileSync(new URL("./fixtures/hierarchy-v2.bin", import.meta.url));
  const xml = readFileSync(new URL("./fixtures/semantics.xml", import.meta.url), "utf8");
  const viewRoots = parseViewHierarchy(viewBytes, {
    screen: SCREEN,
    packageName: "com.example.droidreel.debug",
  });
  const semantics = parseSemanticsXml(xml, "com.example.droidreel.debug");
  return {
    device: {
      serial: "fixture",
      state: "device",
      model: "Fixture",
      product: null,
      device: null,
      transportId: null,
      manufacturer: "Test",
      androidRelease: "13",
      sdk: 33,
    },
    target: {
      serial: "fixture",
      packageName: "com.example.droidreel.debug",
      pid: 1234,
      activity: "com.example.droidreel.community.ui.CommunityActivity",
      debuggable: true,
      windows: [],
    },
    screen: SCREEN,
    source: "view",
    sources: ["view", "semantics"],
    uiKind: "compose",
    view: { window: "fixture", roots: viewRoots, captureMs: 100 },
    semantics: { rotation: 0, roots: semantics.roots, captureMs: 2000 },
    warnings: [],
  };
}

/**
 * Runs `run` with `vars` applied to `process.env` (a `undefined` value unsets the
 * variable), restoring every previous value afterwards. Keeps tests independent of
 * whatever the host machine exports, e.g. a CI image's `JAVA_HOME`.
 */
export async function withEnv(
  vars: Record<string, string | undefined>,
  run: () => Promise<void>,
): Promise<void> {
  const saved = new Map(Object.keys(vars).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

let nodeRef = 0;

export function box(left: number, top: number, right: number, bottom: number): Bounds {
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/**
 * A minimal semantics-shaped node for unit tests; pass `children` for a tree.
 * Defaults describe a visible, enabled, unlabeled container that compacts away.
 */
export function makeTestNode(overrides: Partial<UiNode> = {}): UiNode {
  const bounds = overrides.bounds ?? box(0, 0, 100, 100);
  nodeRef++;
  return {
    id: "0",
    ref: `s${nodeRef}`,
    source: "semantics",
    index: 0,
    depth: 0,
    className: "android.widget.FrameLayout",
    shortClassName: "FrameLayout",
    packageName: "com.example",
    resourceId: null,
    text: null,
    contentDescription: null,
    bounds,
    visibleBounds: overrides.visible === false ? null : bounds,
    center: { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 },
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
    parent: null,
    ...overrides,
  };
}
