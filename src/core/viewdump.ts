import type {
  Bounds,
  EdgeInsets,
  LayoutParams,
  ScreenInfo,
  UiNode,
  ViewDetails,
  Visibility,
} from "./model.js";

export type PropValue = string | number | boolean | PropMap | null;
export interface PropMap {
  [key: string]: PropValue;
}

const SIG = {
  BOOLEAN: 0x5a, // Z
  BYTE: 0x42, // B
  SHORT: 0x53, // S
  INT: 0x49, // I
  LONG: 0x4a, // J
  FLOAT: 0x46, // F
  DOUBLE: 0x44, // D
  STRING: 0x52, // R
  MAP: 0x4d, // M
  END_MAP: 0,
};

type RawValue = number | string | boolean | RawMap;
interface RawMap {
  type: "map";
  entries: Map<number, RawValue>;
}

/**
 * Decodes the binary stream produced by android.view.ViewDebug.dumpv2().
 *
 * The stream is a sequence of objects. The first objects are a small header,
 * then one map per view (nested property maps included), and finally a map that
 * is the property-name string table.
 */
export function decodeViewHierarchy(buffer: Buffer): {
  views: PropMap[];
  propertyNames: Map<number, string>;
} {
  let offset = 0;
  const objects: RawValue[] = [];
  while (offset < buffer.length) {
    objects.push(readObject(buffer, () => offset, (value) => (offset = value)));
  }
  const maps = objects.filter((value): value is RawMap => isRawMap(value));
  if (maps.length === 0) {
    throw new Error("The view hierarchy dump was empty.");
  }
  const table = maps[maps.length - 1];
  const viewMaps = maps.slice(0, -1);
  const propertyNames = new Map<number, string>();
  for (const [key, value] of table.entries) {
    if (typeof value === "string") propertyNames.set(key, value);
  }
  const views = viewMaps.map((map) => toPropMap(map, propertyNames));
  return { views, propertyNames };
}

function isRawMap(value: RawValue): value is RawMap {
  return typeof value === "object" && value !== null && value.type === "map";
}

function readObject(buffer: Buffer, getOffset: () => number, setOffset: (value: number) => void): RawValue {
  const sig = buffer[getOffset()];
  setOffset(getOffset() + 1);
  switch (sig) {
    case SIG.BOOLEAN:
      return buffer.readUInt8(increment(buffer, getOffset, setOffset)) !== 0;
    case SIG.BYTE:
      return buffer.readInt8(increment(buffer, getOffset, setOffset));
    case SIG.SHORT: {
      const position = increment(buffer, getOffset, setOffset, 2);
      return buffer.readInt16BE(position);
    }
    case SIG.INT: {
      const position = increment(buffer, getOffset, setOffset, 4);
      return buffer.readInt32BE(position);
    }
    case SIG.LONG: {
      const position = increment(buffer, getOffset, setOffset, 8);
      return Number(buffer.readBigInt64BE(position));
    }
    case SIG.FLOAT: {
      const position = increment(buffer, getOffset, setOffset, 4);
      return buffer.readFloatBE(position);
    }
    case SIG.DOUBLE: {
      const position = increment(buffer, getOffset, setOffset, 8);
      return buffer.readDoubleBE(position);
    }
    case SIG.STRING: {
      const position = increment(buffer, getOffset, setOffset, 2);
      const chars = buffer.readUInt16BE(position);
      const start = increment(buffer, getOffset, setOffset, chars);
      return buffer.subarray(start, start + chars).toString("utf8");
    }
    case SIG.MAP: {
      const entries = new Map<number, RawValue>();
      while (true) {
        const key = readObject(buffer, getOffset, setOffset);
        if (typeof key === "number" && key === SIG.END_MAP) break;
        if (typeof key !== "number") {
          throw new Error("Malformed view hierarchy map: expected a short key.");
        }
        entries.set(key, readObject(buffer, getOffset, setOffset));
      }
      return { type: "map", entries };
    }
    default:
      throw new Error(
        `Unexpected byte 0x${sig.toString(16)} while decoding the view hierarchy at offset ${getOffset() - 1}.`,
      );
  }
}

function increment(buffer: Buffer, getOffset: () => number, setOffset: (v: number) => void, by = 1): number {
  const position = getOffset();
  if (position + by > buffer.length) {
    throw new Error("Unexpected end of view hierarchy data.");
  }
  setOffset(position + by);
  return position;
}

function toPropMap(map: RawMap, names: Map<number, string>): PropMap {
  const result: PropMap = {};
  for (const [key, value] of map.entries) {
    const name = names.get(key) ?? `#${key}`;
    result[name] = convertValue(value, names);
  }
  return result;
}

function convertValue(value: RawValue, names: Map<number, string>): PropValue {
  if (isRawMap(value)) return toPropMap(value, names);
  return value;
}

const ALIASES = {
  left: ["layout:left", "layout:mLeft", "mLeft", "left"],
  top: ["layout:top", "layout:mTop", "mTop", "top"],
  width: ["layout:width", "layout:getWidth()", "getWidth()", "width"],
  height: ["layout:height", "layout:getHeight()", "getHeight()", "height"],
  right: ["layout:right", "layout:mRight", "mRight", "right"],
  bottom: ["layout:bottom", "layout:mBottom", "mBottom", "bottom"],
  scrollX: ["scrolling:scrollX", "mScrollX", "scrollX"],
  scrollY: ["scrolling:scrollY", "mScrollY", "scrollY"],
  visibility: ["misc:visibility", "getVisibility()", "misc:getVisibility()", "mVisibility", "visibility"],
  alpha: ["drawing:alpha", "misc:transformation.alpha", "getAlpha()", "alpha"],
  translationX: ["drawing:translationX", "getTranslationX", "translationX"],
  translationY: ["drawing:translationY", "getTranslationY", "translationY"],
  scaleX: ["drawing:scaleX", "getScaleX()", "scaleX"],
  scaleY: ["drawing:scaleY", "getScaleY()", "scaleY"],
  elevation: ["drawing:elevation", "getElevation()", "elevation"],
  clipChildren: ["drawing:clipChildren", "getClipChildren()", "clipChildren"],
  willNotDraw: ["drawing:willNotDraw", "willNotDraw()", "willNotDraw"],
  clickable: ["misc:clickable", "isClickable()", "clickable"],
  enabled: ["misc:enabled", "isEnabled()", "enabled"],
  focusable: ["focus:isFocusable", "isFocusable()", "focusable"],
  focused: ["focus:isFocused", "isFocused()", "focused"],
  selected: ["misc:selected", "isSelected()", "selected"],
  longClickable: ["misc:longClickable", "isLongClickable()", "longClickable"],
  contentDescription: [
    "accessibility:contentDescription",
    "accessibility:getContentDescription()",
    "getContentDescription()",
    "contentDescription",
  ],
  text: ["text:text", "text:mText", "mText", "text"],
  hint: ["text:hint", "text:mHint", "mHint", "hint"],
  id: ["id", "mID", "mResolvedId"],
  theme: ["theme"],
  layoutParams: ["layoutParams"],
  paddingLeft: ["padding:paddingLeft", "mPaddingLeft", "paddingLeft"],
  paddingTop: ["padding:paddingTop", "mPaddingTop", "paddingTop"],
  paddingRight: ["padding:paddingRight", "mPaddingRight", "paddingRight"],
  paddingBottom: ["padding:paddingBottom", "mPaddingBottom", "paddingBottom"],
  marginLeft: ["layoutParams:leftMargin", "mMarginLeft", "leftMargin"],
  marginTop: ["layoutParams:topMargin", "mMarginTop", "topMargin"],
  marginRight: ["layoutParams:rightMargin", "mMarginRight", "rightMargin"],
  marginBottom: ["layoutParams:bottomMargin", "mMarginBottom", "bottomMargin"],
} as const;

function findProp(props: PropMap, aliases: readonly string[]): PropValue | undefined {
  for (const alias of aliases) {
    if (alias in props) return props[alias];
  }
  return undefined;
}

function numberProp(props: PropMap, aliases: readonly string[], fallback = 0): number {
  const value = findProp(props, aliases);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function booleanProp(props: PropMap, aliases: readonly string[], fallback = false): boolean {
  const value = findProp(props, aliases);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value === "true" || value === "1";
  return fallback;
}

function stringProp(props: PropMap, aliases: readonly string[]): string | null {
  const value = findProp(props, aliases);
  if (typeof value === "string") {
    if (value === "null" || value === "") return null;
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function visibilityProp(props: PropMap): Visibility {
  const value = findProp(props, ALIASES.visibility);
  if (typeof value === "string") {
    if (value === "VISIBLE" || value === "0") return "visible";
    if (value === "INVISIBLE" || value === "4") return "invisible";
    return "gone";
  }
  if (value === 0) return "visible";
  if (value === 4) return "invisible";
  return "gone";
}

export interface ParseViewOptions {
  screen: ScreenInfo;
  packageName?: string | null;
  includeProperties?: boolean;
}

export function parseViewHierarchy(
  buffer: Buffer,
  options: ParseViewOptions,
): UiNode[] {
  const { views } = decodeViewHierarchy(buffer);
  if (views.length === 0) return [];
  const roots: UiNode[] = [];
  const refCounter = { value: 0 };
  for (const view of views) {
    // Only treat a top-level map with a meta name as a window root.
    if (!("meta:__name__" in view)) continue;
    const node = buildNode(view, null, "0", 0, 0, options, refCounter);
    roots.push(node);
  }
  const screenBounds: Bounds = {
    left: 0,
    top: 0,
    right: options.screen.width || 10000,
    bottom: options.screen.height || 10000,
    width: options.screen.width || 10000,
    height: options.screen.height || 10000,
  };
  for (const root of roots) {
    computeBounds(root, 0, 0, 0, 0, screenBounds);
  }
  return roots;
}

function buildNode(
  props: PropMap,
  parent: UiNode | null,
  path: string,
  depth: number,
  index: number,
  options: ParseViewOptions,
  refCounter: { value: number },
): UiNode {
  const className = stringProp(props, ["meta:__name__"]) ?? "android.view.View";
  const hashValue = findProp(props, ["meta:__hash__"]);
  const hash =
    typeof hashValue === "number"
      ? (hashValue >>> 0).toString(16)
      : typeof hashValue === "string"
        ? hashValue
        : null;
  const visibility = visibilityProp(props);
  const rawId = stringProp(props, ALIASES.id);
  const resourceId = normalizeResourceId(rawId);
  const padding: EdgeInsets = {
    left: numberProp(props, ALIASES.paddingLeft),
    top: numberProp(props, ALIASES.paddingTop),
    right: numberProp(props, ALIASES.paddingRight),
    bottom: numberProp(props, ALIASES.paddingBottom),
  };
  const layoutParamsValue = findProp(props, ALIASES.layoutParams);
  const layoutParams: LayoutParams = {
    className:
      isPropMap(layoutParamsValue) && typeof layoutParamsValue["meta:__name__"] === "string"
        ? (layoutParamsValue["meta:__name__"] as string)
        : null,
    width: isPropMap(layoutParamsValue) ? numberProp(layoutParamsValue, ["width", "mWidth"], 0) : null,
    height: isPropMap(layoutParamsValue)
      ? numberProp(layoutParamsValue, ["height", "mHeight"], 0)
      : null,
    margins: isPropMap(layoutParamsValue)
      ? {
          left: numberProp(layoutParamsValue, ["leftMargin", "mMarginLeft", "marginLeft"], 0),
          top: numberProp(layoutParamsValue, ["topMargin", "mMarginTop", "marginTop"], 0),
          right: numberProp(layoutParamsValue, ["rightMargin", "mMarginRight", "marginRight"], 0),
          bottom: numberProp(layoutParamsValue, ["bottomMargin", "mMarginBottom", "marginBottom"], 0),
        }
      : null,
  };
  const details: ViewDetails = {
    hash,
    visibility,
    alpha: numberProp(props, ALIASES.alpha, 1),
    left: numberProp(props, ALIASES.left),
    top: numberProp(props, ALIASES.top),
    width: numberProp(props, ALIASES.width),
    height: numberProp(props, ALIASES.height),
    scrollX: numberProp(props, ALIASES.scrollX),
    scrollY: numberProp(props, ALIASES.scrollY),
    translationX: numberProp(props, ALIASES.translationX),
    translationY: numberProp(props, ALIASES.translationY),
    scaleX: numberProp(props, ALIASES.scaleX, 1),
    scaleY: numberProp(props, ALIASES.scaleY, 1),
    elevation: numberProp(props, ALIASES.elevation),
    clipChildren: booleanProp(props, ALIASES.clipChildren, true),
    willNotDraw: booleanProp(props, ALIASES.willNotDraw),
    padding,
    layoutParams,
    theme: stringProp(props, ALIASES.theme),
  };
  if (options.includeProperties) {
    details.properties = allScalarProperties(props);
  }
  const node: UiNode = {
    id: path,
    ref: `v${refCounter.value++}`,
    source: "view",
    index,
    depth,
    className,
    shortClassName: simpleClassName(className),
    packageName: options.packageName ?? null,
    resourceId,
    text: stringProp(props, ALIASES.text),
    contentDescription: stringProp(props, ALIASES.contentDescription),
    bounds: {
      left: details.left,
      top: details.top,
      right: details.left + details.width,
      bottom: details.top + details.height,
      width: details.width,
      height: details.height,
    },
    visibleBounds: null,
    center: { x: details.left + details.width / 2, y: details.top + details.height / 2 },
    visible: visibility === "visible",
    enabled: booleanProp(props, ALIASES.enabled, true),
    clickable: booleanProp(props, ALIASES.clickable),
    longClickable: booleanProp(props, ALIASES.longClickable),
    focusable: booleanProp(props, ALIASES.focusable),
    focused: booleanProp(props, ALIASES.focused),
    scrollable:
      details.scrollX !== 0 ||
      details.scrollY !== 0 ||
      /scroll|recycler|viewpager|viewflipper|horizontalpager/i.test(className),
    checkable: false,
    checked: false,
    selected: booleanProp(props, ALIASES.selected),
    password: false,
    children: [],
    view: details,
    parent,
  };
  const children: { index: number; props: PropMap }[] = [];
  for (const [name, value] of Object.entries(props)) {
    const match = name.match(/^meta:__child__(\d+)$/);
    if (match && isPropMap(value)) {
      children.push({ index: Number.parseInt(match[1], 10), props: value });
    }
  }
  children.sort((a, b) => a.index - b.index);
  for (const child of children) {
    const childNode = buildNode(
      child.props,
      node,
      `${path}.${child.index}`,
      depth + 1,
      child.index,
      options,
      refCounter,
    );
    node.children.push(childNode);
  }
  return node;
}

function isPropMap(value: PropValue | undefined): value is PropMap {
  return typeof value === "object" && value !== null;
}

function computeBounds(
  node: UiNode,
  parentScrollX: number,
  parentScrollY: number,
  parentAbsX: number,
  parentAbsY: number,
  clip: Bounds | null,
  ancestorsVisible = true,
): void {
  const details = node.view!;
  const absX = parentAbsX + details.left - parentScrollX + details.translationX;
  const absY = parentAbsY + details.top - parentScrollY + details.translationY;
  const width = Math.max(0, details.width);
  const height = Math.max(0, details.height);
  const raw: Bounds = {
    left: Math.round(absX),
    top: Math.round(absY),
    right: Math.round(absX + width),
    bottom: Math.round(absY + height),
    width,
    height,
  };
  node.bounds = raw;
  const selfVisible = details.visibility === "visible" && details.alpha > 0;
  const visible = ancestorsVisible && selfVisible && width > 0 && height > 0;
  node.visible = visible;
  node.visibleBounds = visible && clip ? intersect(raw, clip) : null;
  node.center = node.visibleBounds
    ? {
        x: (node.visibleBounds.left + node.visibleBounds.right) / 2,
        y: (node.visibleBounds.top + node.visibleBounds.bottom) / 2,
      }
    : { x: raw.left + width / 2, y: raw.top + height / 2 };

  const childClip = details.clipChildren && clip ? intersect(clip, raw) : clip;
  // A zero-sized parent with clipChildren=false can still draw children, so
  // only visibility/alpha of the ancestor is propagated here (not size).
  const childrenVisible = ancestorsVisible && selfVisible;
  for (const child of node.children) {
    computeBounds(child, details.scrollX, details.scrollY, absX, absY, childClip, childrenVisible);
  }
}

export function intersect(a: Bounds, b: Bounds): Bounds | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right <= left || bottom <= top) return null;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function allScalarProperties(props: PropMap): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("meta:__child") || key.startsWith("meta:__attr")) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    } else if (isPropMap(value) && key === "layoutParams") {
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        if (nestedKey.startsWith("meta:__")) continue;
        if (
          typeof nestedValue === "string" ||
          typeof nestedValue === "number" ||
          typeof nestedValue === "boolean"
        ) {
          result[`layoutParams.${nestedKey}`] = nestedValue;
        }
      }
    }
  }
  return result;
}

export function normalizeResourceId(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "NO_ID" || trimmed === "null" || trimmed === "0") return null;
  return trimmed;
}

export function simpleClassName(className: string): string {
  const last = className.split(".").pop();
  if (!last) return className;
  return last.replace(/\$/g, ".");
}

/** Recursively assigns short refs in pre-order; used after any tree transform. */
export function assignRefs(roots: UiNode[], prefix: "v" | "s" | "d" | "c"): void {
  let counter = 0;
  const walk = (node: UiNode, parent: UiNode | null, index: number, depth: number, path: string) => {
    node.ref = `${prefix}${counter++}`;
    node.parent = parent;
    node.index = index;
    node.depth = depth;
    node.id = path;
    node.children.forEach((child, i) => walk(child, node, i, depth + 1, `${path}.${i}`));
  };
  roots.forEach((root, index) => walk(root, null, index, 0, String(index)));
}

/** Flattens a forest in pre-order. */
export function flattenNodes(roots: UiNode[]): UiNode[] {
  const result: UiNode[] = [];
  const walk = (node: UiNode) => {
    result.push(node);
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return result;
}

export interface SerializeNodeOptions {
  depth?: number;
  includeProps?: boolean;
  maxNodes?: number;
  counter?: { value: number };
}

/** Serialises a node tree for JSON output, removing parent back-references. */
export function serializeNode(node: UiNode, options: SerializeNodeOptions = {}): unknown {
  const depth = options.depth;
  if (options.counter) {
    if (options.maxNodes !== undefined && options.counter.value >= options.maxNodes) {
      return {
        id: node.id,
        ref: node.ref,
        className: node.className,
        truncated: true,
        childrenCount: node.children.length,
      };
    }
    options.counter.value++;
  }
  const result: Record<string, unknown> = {
    id: node.id,
    ref: node.ref,
    source: node.source,
    index: node.index,
    depth: node.depth,
    className: node.className,
    resourceId: node.resourceId,
    text: node.text,
    contentDescription: node.contentDescription,
    bounds: node.bounds,
    visibleBounds: node.visibleBounds,
    center: { x: Math.round(node.center.x), y: Math.round(node.center.y) },
    visible: node.visible,
    enabled: node.enabled,
    clickable: node.clickable,
    longClickable: node.longClickable,
    focusable: node.focusable,
    focused: node.focused,
    scrollable: node.scrollable,
    checkable: node.checkable,
    checked: node.checked,
    selected: node.selected,
    password: node.password,
  };
  if (node.view) {
    const view = node.view;
    result.view = {
      hash: view.hash,
      visibility: view.visibility,
      alpha: view.alpha,
      scrollX: view.scrollX,
      scrollY: view.scrollY,
      translationX: view.translationX,
      translationY: view.translationY,
      scaleX: view.scaleX,
      scaleY: view.scaleY,
      elevation: view.elevation,
      clipChildren: view.clipChildren,
      willNotDraw: view.willNotDraw,
      padding: view.padding,
      layoutParams: view.layoutParams,
      ...(view.theme ? { theme: view.theme } : {}),
      ...(options.includeProps && view.properties ? { properties: view.properties } : {}),
    };
  }
  if (node.attributes) result.attributes = node.attributes;
  if (node.compose) result.compose = node.compose;
  if (depth === undefined || depth < 0 || node.depth < depth) {
    result.children = node.children.map((child) =>
      serializeNode(child, {
        ...options,
        depth: depth === undefined ? undefined : depth - 1,
      }),
    );
  } else {
    result.children = [];
    if (node.children.length > 0) result.childrenCount = node.children.length;
  }
  return result;
}
