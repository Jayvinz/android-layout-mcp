export type SourceMode = "auto" | "view" | "semantics" | "compose" | "both";
export type NodeSource = "view" | "semantics" | "compose";
export type UiKind = "xml" | "compose" | "mixed" | "unknown";
export type Visibility = "visible" | "invisible" | "gone";

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface EdgeInsets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface LayoutParams {
  className: string | null;
  width: number | null;
  height: number | null;
  margins: EdgeInsets | null;
}

export interface ViewDetails {
  hash: string | null;
  visibility: Visibility;
  alpha: number;
  /** Layout coordinates relative to the parent, as reported by ViewDebug. */
  left: number;
  top: number;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  translationX: number;
  translationY: number;
  scaleX: number;
  scaleY: number;
  elevation: number;
  clipChildren: boolean;
  willNotDraw: boolean;
  padding: EdgeInsets;
  layoutParams: LayoutParams;
  theme: string | null;
  /** Raw ViewDebug properties, only populated when full properties are requested. */
  properties?: Record<string, string | number | boolean>;
}

export interface ComposeDetails {
  /** Runtime slot-table node id reported by the Compose inspector. */
  composeId: string;
  name: string;
  fileName: string;
  lineNumber: number;
  offset: number;
  anchorHash: number;
  recomposeCount: number;
  recomposeSkips: number;
  flags: string[];
  renderQuad?: number[];
}

export interface UiNode {
  /** Stable within one dump: pre-order index path, e.g. "0.2.1". */
  id: string;
  /** Short id for human output, e.g. "v12" (view) or "s12" (semantics). */
  ref: string;
  source: NodeSource;
  index: number;
  depth: number;
  className: string;
  shortClassName: string;
  packageName: string | null;
  resourceId: string | null;
  text: string | null;
  contentDescription: string | null;
  /** Raw screen bounds (for view source this is accumulated without clipping). */
  bounds: Bounds;
  /**
   * Bounds after clipping by the ancestors and the screen. `null` when the node
   * is fully clipped / zero-sized.
   */
  visibleBounds: Bounds | null;
  /** Center of visibleBounds when available, else center of raw bounds. */
  center: Point;
  visible: boolean;
  enabled: boolean;
  clickable: boolean;
  longClickable: boolean;
  focusable: boolean;
  focused: boolean;
  scrollable: boolean;
  checkable: boolean;
  checked: boolean;
  selected: boolean;
  password: boolean;
  children: UiNode[];
  view?: ViewDetails;
  compose?: ComposeDetails;
  attributes?: Record<string, string>;
  /** Internal: parent link, stripped when serialising. */
  parent?: UiNode | null;
}

export interface DeviceInfo {
  serial: string;
  state: string;
  model: string | null;
  product: string | null;
  device: string | null;
  transportId: string | null;
  manufacturer: string | null;
  androidRelease: string | null;
  sdk: number | null;
}

export interface ScreenInfo {
  width: number;
  height: number;
  density: number;
  densityDpi: number;
  /** 0 = portrait, 1 = landscape (best effort). */
  orientation: "portrait" | "landscape" | "unknown";
  rotation: number | null;
}

export interface ForegroundApp {
  packageName: string | null;
  activity: string | null;
  raw: string | null;
}

export interface WindowInfo {
  index: number;
  name: string;
  packageName: string | null;
  activity: string | null;
}

export interface CaptureTarget {
  serial: string;
  packageName: string | null;
  pid: number | null;
  activity: string | null;
  debuggable: boolean | null;
  windows?: WindowInfo[];
  selectedWindow?: string;
}

export interface CaptureResult {
  device: DeviceInfo;
  target: CaptureTarget;
  screen: ScreenInfo;
  source: NodeSource;
  sources: NodeSource[];
  uiKind: UiKind;
  view?: {
    window: string;
    roots: UiNode[];
    captureMs: number;
  };
  semantics?: {
    rotation: number;
    roots: UiNode[];
    captureMs: number;
  };
  compose?: {
    rootViewId: number;
    roots: UiNode[];
    captureMs: number;
  };
  warnings: string[];
}

export interface HitCandidate {
  node: UiNode;
  area: number;
  contains: boolean;
  depth: number;
}

export interface Issue {
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  nodeId: string;
  nodeRef: string;
  source: NodeSource;
  className: string;
  label: string | null;
  bounds: Bounds | null;
  path: string;
}

export interface AnalyzeResult {
  issues: Issue[];
  counts: Record<string, number>;
  dp: number;
  nodeCount: number;
}

export interface DumpFile {
  version: 1;
  createdAt: string;
  device: DeviceInfo;
  target: CaptureTarget;
  screen: ScreenInfo;
  source: NodeSource;
  sources: NodeSource[];
  uiKind: UiKind;
  view?: CaptureResult["view"];
  semantics?: CaptureResult["semantics"];
  compose?: CaptureResult["compose"];
  warnings: string[];
}
