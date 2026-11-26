import { XMLParser } from "fast-xml-parser";
import { assignRefs, simpleClassName } from "./viewdump.js";
/**
 * Parses the XML produced by `adb shell uiautomator dump`.
 *
 * The semantics tree is the best source for Jetpack Compose apps: Compose
 * exposes text/accessibility nodes and bounds through accessibility, while the
 * ViewDebug hierarchy stops at AndroidComposeView.
 */
export function parseSemanticsXml(xml, screenOrPackage, packageName) {
    // Keep the historical (xml, screen, packageName) signature while allowing
    // callers that do not need screen geometry to pass the package directly.
    const effectivePackage = typeof screenOrPackage === "string" ? screenOrPackage : packageName;
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
    const document = parser.parse(cleaned);
    if (!document.hierarchy) {
        throw new Error("uiautomator returned an empty hierarchy.");
    }
    const hierarchy = document.hierarchy;
    const rotation = toNumber(hierarchy.rotation) ?? 0;
    const roots = [];
    if (hierarchy.node) {
        const raw = hierarchy.node;
        roots.push(...(Array.isArray(raw) ? raw : [raw]));
    }
    const parsedRoots = roots.map((raw) => parseNode(raw, effectivePackage));
    assignRefs(parsedRoots, "s");
    return {
        roots: parsedRoots,
        rotation,
        attributes: collectAttributes(hierarchy),
    };
}
function extractXml(input) {
    const start = input.indexOf("<?xml");
    if (start > 0)
        return input.slice(start);
    const hierarchy = input.indexOf("<hierarchy");
    if (hierarchy > 0)
        return input.slice(hierarchy);
    return input;
}
function parseNode(raw, packageName) {
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
    const attributes = {};
    for (const [key, value] of Object.entries(raw)) {
        if (key === "node" || typeof value !== "string")
            continue;
        attributes[key] = value;
    }
    const text = nonEmpty(stringAttr(raw, "text"));
    const contentDescription = nonEmpty(stringAttr(raw, "content-desc"));
    const resourceId = nonEmpty(stringAttr(raw, "resource-id"));
    const node = {
        // Derived fields are assigned once by assignRefs after the tree is built.
        id: "",
        ref: "",
        source: "semantics",
        index: 0,
        depth: 0,
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
        parent: null,
    };
    const rawChildren = raw.node;
    const children = rawChildren ? (Array.isArray(rawChildren) ? rawChildren : [rawChildren]) : [];
    node.children = children.map((child) => parseNode(child, packageName));
    return node;
}
function parseBounds(value) {
    if (!value)
        return null;
    const match = value.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
    if (!match)
        return null;
    // Accessibility sometimes reports a rect with left>right or top>bottom; sort
    // it the way Android does (`Rect.sort`) so width/height never go negative and
    // every downstream consumer (visibleBounds, center, hit test) sees a valid box.
    const left = Math.min(Number.parseInt(match[1], 10), Number.parseInt(match[3], 10));
    const top = Math.min(Number.parseInt(match[2], 10), Number.parseInt(match[4], 10));
    const right = Math.max(Number.parseInt(match[1], 10), Number.parseInt(match[3], 10));
    const bottom = Math.max(Number.parseInt(match[2], 10), Number.parseInt(match[4], 10));
    return {
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top,
    };
}
function stringAttr(raw, key) {
    const value = raw[key];
    if (typeof value === "string")
        return value;
    if (typeof value === "number" || typeof value === "boolean")
        return String(value);
    return null;
}
function boolAttr(raw, key, fallback = false) {
    const value = stringAttr(raw, key);
    if (value === null)
        return fallback;
    return value === "true" || value === "1";
}
function nonEmpty(value) {
    if (value === null)
        return null;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : value;
}
function toNumber(value) {
    if (typeof value === "number")
        return value;
    if (typeof value === "string") {
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
function collectAttributes(hierarchy) {
    const result = {};
    for (const [key, value] of Object.entries(hierarchy)) {
        if (key === "node")
            continue;
        if (typeof value === "string")
            result[key] = value;
    }
    return result;
}
