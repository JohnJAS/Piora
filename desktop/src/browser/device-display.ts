import type { DeviceViewport } from "./contracts.js";
interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const devices = [
  ["responsive", 390, 844],
  ["iPhone SE", 375, 667],
  ["iPhone 15 Pro", 393, 852],
  ["iPhone 15 Pro Max", 430, 932],
  ["Pixel 8", 412, 915],
  ["Galaxy S24 Ultra", 412, 915],
  ["Surface Duo", 540, 720],
  ["iPad Mini", 768, 1024],
  ["iPad Air", 820, 1180],
  ["Surface Pro 7", 912, 1368],
  ["Laptop", 1024, 768],
  ["Laptop L", 1440, 900],
  ["4K", 2560, 1440],
] as const;

export function fitViewport(panel: Bounds, viewport: DeviceViewport) {
  const rail = Math.min(8, Math.max(0, Math.floor((Math.min(panel.width, panel.height) - 1) / 3)));
  const scale = Math.min(
    viewport.preview || 1,
    (panel.width - 2 * rail) / viewport.width,
    (panel.height - rail) / viewport.height,
  );
  const width = Math.max(1, Math.round(viewport.width * scale));
  const height = Math.max(1, Math.round(viewport.height * scale));
  return { scale, bounds: { x: panel.x + Math.round((panel.width - width) / 2), y: panel.y, width, height } };
}
