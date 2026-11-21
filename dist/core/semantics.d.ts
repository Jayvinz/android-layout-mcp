import type { ScreenInfo, UiNode } from "./model.js";
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
export declare function parseSemanticsXml(xml: string, screenOrPackage?: ScreenInfo | string | null, packageName?: string | null): SemanticsParseResult;
