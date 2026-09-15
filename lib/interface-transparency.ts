export const INTERFACE_TRANSPARENCY_STORAGE_KEY = "pi-interface-transparency:v1";
export const DEFAULT_INTERFACE_TRANSPARENCY = 80;

export function normalizeInterfaceTransparency(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(100, Math.max(0, Math.round(value)))
    : DEFAULT_INTERFACE_TRANSPARENCY;
}

export function parseInterfaceTransparency(raw: string | null): number {
  try {
    const value = JSON.parse(raw ?? "null");
    return value?.schemaVersion === 1
      ? normalizeInterfaceTransparency(value.transparency)
      : DEFAULT_INTERFACE_TRANSPARENCY;
  } catch {
    return DEFAULT_INTERFACE_TRANSPARENCY;
  }
}

export function serializeInterfaceTransparency(value: number): string {
  return JSON.stringify({ schemaVersion: 1, transparency: normalizeInterfaceTransparency(value) });
}

// Apply before first paint, matching the other appearance preferences.
export const INTERFACE_TRANSPARENCY_INITIALIZATION_SCRIPT = `(function(){try{var v=JSON.parse(localStorage.getItem("${INTERFACE_TRANSPARENCY_STORAGE_KEY}")||"null"),n=v&&v.schemaVersion===1?v.transparency:null,t=typeof n==="number"&&Number.isFinite(n)?Math.min(100,Math.max(0,Math.round(n))):${DEFAULT_INTERFACE_TRANSPARENCY},r=document.documentElement;r.dataset.interfaceTransparency=String(t);r.style.setProperty("--interface-transparency",String(t))}catch(_){}})();`;
