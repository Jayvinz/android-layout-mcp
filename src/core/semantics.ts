import { XMLParser } from "fast-xml-parser";
import type { Bounds, ScreenInfo, UiNode } from "./model.js";
import { assignRefs, simpleClassName } from "./viewdump.js";

interface RawNode {
  node?: RawNode | RawNode[];
  [key: string]: unknown;
}

export interface SemanticsParseResult {
  roots: UiNode[];
  rotation: number;
  attributes: Record<string, string>;
}

/**
 * Parses the XML produced by `adb shell uiautomator dump`.
 *
 * The semantics tree is the best source for Jetpack Compose apps: Compose
 * exposes text/accessibility nodes and bounds through accessibility, while the
 * ViewDebug hierarchy stops at AndroidComposeView.
 */
export function parseSemanticsXml(xml: string, screen: ScreenInfo, packageName?: string | null): SemanticsParseResult {
  const cleaned = extractXml(xml);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    allowBooleanAttributes: true,
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true,
    isArray: (name) => name === "node",
  });
  const document = parser.parse(cleaned) as {
    hierarchy?: RawNode & { rotation?: string };
  };
  if (!document.hierarchy) {
    throw new Error("uiautomator returned an empty hierarchy.");
  }
  const hierarchy = document.hierarchy;
  const rotation = toNumber(hierarchy.rotation) ?? 0;
  const roots: RawNode[] = [];
  if (hierarchy.node) {
    const raw = hierarchy.node;
    roots.push(...(Array.isArray(raw) ? raw : [raw]));
  }
  const parsedRoots = roots.map((raw, index) => {
    const counter = { value: 0 };
    return parseNode(raw, null, String(index), 0, index, counter, packageName);
  });
  assignRefs(parsedRoots, "s");
  return {
    roots: parsedRoots,
    rotation,
    attributes: collectAttributes(hierarchy),
  };
}

function extractXml(input: string): string {
  const start = input.indexOf("<?xml");
  if (start > 0) return input.slice(start);
  const hierarchy = input.indexOf("<hierarchy");
  if (hierarchy > 0) return input.slice(hierarchy);
  return input;
}

function parseNode(
  raw: RawNode,
  parent: UiNode | null,
  path: string,
  depth: number,
  index: number,
  counter: { value: number },
  packageName?: string | null,
): UiNode {
  const className = stringAttr(raw, "class") || "android.view.View";
  const bounds = parseBounds(stringAttr(raw, "bounds")) ?? {
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
  };
  const visible = bounds.width > 0 && bounds.height > 0;
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "node" || typeof value !== "string") continue;
    attributes[key] = value;
  }
  const text = nonEmpty(stringAttr(raw, "text"));
  const contentDescription = nonEmpty(stringAttr(raw, "content-desc"));
  const resourceId = nonEmpty(stringAttr(raw, "resource-id"));
  const node: UiNode = {
    id: path,
    ref: `s${counter.value++}`,
    source: "semantics",
    index,
    depth,
    className,
    shortClassName: simpleClassName(className),
    packageName: nonEmpty(stringAttr(raw, "package")) ?? packageName ?? null,
    resourceId,
    text,
    contentDescription,
    bounds,
    visibleBounds: visible ? bounds : null,
    center: { x: bounds.width ? bounds.left + bounds.width / 2 : 0, y: bounds.height ? bounds.top + bounds.height / 2 : 0 },
    visible,
    enabled: boolAttr(raw, "enabled", true),
    clickable: boolAttr(raw, "clickable"),
    longClickable: boolAttr(raw, "long-clickable"),
    focusable: boolAttr(raw, "focusable"),
    focused: boolAttr(raw, "focused"),
    scrollable: boolAttr(raw, "scrollable"),
    checkable: boolAttr(raw, "checkable"),
    checked: boolAttr(raw, "checked"),
    selected: boolAttr(raw, "selected"),
    password: boolAttr(raw, "password"),
    children: [],
    attributes,
    parent,
  };
  const rawChildren = raw.node;
  const children = rawChildren ? (Array.isArray(rawChildren) ? rawChildren : [rawChildren]) : [];
  node.children = children.map((child, childIndex) =>
    parseNode(child, node, `${path}.${childIndex}`, depth + 1, childIndex, counter, packageName),
  );
  return node;
}

function parseBounds(value: string | null): Bounds | null {
  if (!value) return null;
  const match = value.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
  if (!match) return null;
  const left = Number.parseInt(match[1], 10);
  const top = Number.parseInt(match[2], 10);
  const right = Number.parseInt(match[3], 10);
  const bottom = Number.parseInt(match[4], 10);
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

function stringAttr(raw: RawNode, key: string): string | null {
  const value = raw[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function boolAttr(raw: RawNode, key: string, fallback = false): boolean {
  const value = stringAttr(raw, key);
  if (value === null) return fallback;
  return value === "true" || value === "1";
}

function nonEmpty(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : value;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function collectAttributes(hierarchy: RawNode & { rotation?: string }): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(hierarchy)) {
    if (key === "node") continue;
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

/** Convenience for tests and tools that need the raw XML screen dimensions. */
export function semanticsRootBounds(roots: UiNode[]): Bounds | null {
  return roots.length > 0 ? roots[0].bounds : null;
}
