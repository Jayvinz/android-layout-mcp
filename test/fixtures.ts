import { readFileSync } from "node:fs";
import type { CaptureResult, ScreenInfo } from "../src/core/model.js";
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
