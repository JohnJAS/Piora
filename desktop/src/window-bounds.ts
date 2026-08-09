export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function intersectionArea(a: WindowBounds, b: WindowBounds): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function sameBounds(a: WindowBounds, b: WindowBounds): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function fitBoundsToVisibleDisplays(
  bounds: WindowBounds,
  workAreas: readonly WindowBounds[],
  fallbackWorkArea: WindowBounds,
  minimumSize: { width: number; height: number },
): WindowBounds {
  const candidates = workAreas.length > 0 ? workAreas : [fallbackWorkArea];
  let target = fallbackWorkArea;
  let bestArea = 0;
  for (const workArea of candidates) {
    const area = intersectionArea(bounds, workArea);
    if (area > bestArea) {
      bestArea = area;
      target = workArea;
    }
  }

  const width = Math.min(target.width, Math.max(minimumSize.width, bounds.width));
  const height = Math.min(target.height, Math.max(minimumSize.height, bounds.height));
  const fitted = {
    x: Math.min(Math.max(bounds.x, target.x), target.x + Math.max(0, target.width - width)),
    y: Math.min(Math.max(bounds.y, target.y), target.y + Math.max(0, target.height - height)),
    width,
    height,
  };
  return sameBounds(bounds, fitted) ? bounds : fitted;
}
