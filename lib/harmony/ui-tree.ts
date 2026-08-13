import type { HarmonyBounds } from "./types";

export interface ParsedUiNode {
  parentIndex?: number;
  text?: string;
  id?: string;
  type?: string;
  hint?: string;
  description?: string;
  bounds?: HarmonyBounds;
  enabled?: boolean;
  clickable?: boolean;
  scrollable?: boolean;
  focused?: boolean;
  selected?: boolean;
  checked?: boolean;
  visible?: boolean;
}

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1" || value === 1) return true;
  if (value === "false" || value === "0" || value === 0) return false;
  return undefined;
}

export function parseBounds(value: unknown): HarmonyBounds | undefined {
  if (typeof value === "string") {
    const numbers = value.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
    if (numbers && numbers.length >= 4 && numbers.slice(0, 4).every(Number.isFinite)) {
      return { left: numbers[0], top: numbers[1], right: numbers[2], bottom: numbers[3] };
    }
    return undefined;
  }
  if (Array.isArray(value) && value.length >= 4) {
    const numbers = value.slice(0, 4).map(finiteNumber);
    if (numbers.every((number) => number !== undefined)) {
      return { left: numbers[0]!, top: numbers[1]!, right: numbers[2]!, bottom: numbers[3]! };
    }
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const left = finiteNumber(record.left ?? record.leftTopX ?? record.x1 ?? record.startX);
  const top = finiteNumber(record.top ?? record.leftTopY ?? record.y1 ?? record.startY);
  const right = finiteNumber(record.right ?? record.rightBottomX ?? record.x2 ?? record.endX);
  const bottom = finiteNumber(record.bottom ?? record.rightBottomY ?? record.y2 ?? record.endY);
  return left === undefined || top === undefined || right === undefined || bottom === undefined
    ? undefined
    : { left, top, right, bottom };
}

function first(record: Record<string, unknown>, names: string[]): unknown {
  for (const name of names) {
    if (record[name] !== undefined) return record[name];
  }
  return undefined;
}

function probableNode(record: Record<string, unknown>): boolean {
  return [
    "attributes", "bounds", "rect", "text", "id", "key", "type", "bundleName", "children",
    "clickable", "enabled", "description", "hint",
  ].some((key) => key in record);
}

/** Converts UiTest dump variants to a compact, bounded flat node list. */
export function flattenUiTree(tree: unknown, maxNodes = 10_000): ParsedUiNode[] {
  const result: ParsedUiNode[] = [];
  const visited = new Set<object>();

  const visit = (value: unknown, parentIndex?: number): void => {
    if (result.length >= maxNodes || !value || typeof value !== "object") return;
    if (visited.has(value as object)) return;
    visited.add(value as object);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, parentIndex);
      return;
    }

    const record = value as Record<string, unknown>;
    const attributes = record.attributes && typeof record.attributes === "object" && !Array.isArray(record.attributes)
      ? record.attributes as Record<string, unknown>
      : {};
    const merged = { ...record, ...attributes };
    let thisIndex = parentIndex;
    if (probableNode(record)) {
      thisIndex = result.length;
      result.push({
        ...(parentIndex === undefined ? {} : { parentIndex }),
        text: stringValue(first(merged, ["text", "content", "value"])),
        id: stringValue(first(merged, ["id", "key", "resourceId", "inspectorId", "uniqueId"])),
        type: stringValue(first(merged, ["type", "componentType", "className"])),
        hint: stringValue(first(merged, ["hint", "placeholder"])),
        description: stringValue(first(merged, ["description", "accessibilityText"])),
        bounds: parseBounds(first(merged, ["bounds", "rect", "bound", "visibleBounds"])),
        enabled: booleanValue(merged.enabled),
        clickable: booleanValue(merged.clickable),
        scrollable: booleanValue(merged.scrollable),
        focused: booleanValue(merged.focused),
        selected: booleanValue(merged.selected),
        checked: booleanValue(merged.checked),
        visible: booleanValue(first(merged, ["visible", "isVisible"])),
      });
    }

    const childKeys = ["children", "child", "nodes", "components", "windows"];
    let traversedChildren = false;
    for (const key of childKeys) {
      if (record[key] !== undefined) {
        traversedChildren = true;
        visit(record[key], thisIndex);
      }
    }
    if (!traversedChildren && thisIndex === parentIndex) {
      for (const nested of Object.values(record)) visit(nested, parentIndex);
    }
  };

  visit(tree);
  return result;
}
