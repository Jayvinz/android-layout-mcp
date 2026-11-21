import type { Bounds, ScreenInfo, UiNode } from "./model.js";
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
export declare function parseSemanticsXml(xml: string, screen: ScreenInfo, packageName?: string | null): SemanticsParseResult;
/** Convenience for tests and tools that need the raw XML screen dimensions. */
export declare function semanticsRootBounds(roots: UiNode[]): Bounds | null;
