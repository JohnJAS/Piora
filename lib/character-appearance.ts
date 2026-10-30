import { isTheme, type Theme } from "./theme-preferences.ts";
import { normalizeBackgroundPreference, type BackgroundPreference } from "./backgrounds.ts";

export const PREVIOUS_CHARACTER_APPEARANCE_KEY = "pi-character-appearance:previous:v1";
export interface PreviousCharacterAppearance {
  theme: Theme;
  background: BackgroundPreference;
}

export function parsePreviousCharacterAppearance(raw: string | null): PreviousCharacterAppearance | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || !isTheme(value.theme) || !value.background || typeof value.background !== "object") return null;
    const background = normalizeBackgroundPreference(value.background);
    // An unknown/removed built-in asset must not silently become a saved blank look.
    if (background.source !== value.background.source) return null;
    return { theme: value.theme, background };
  } catch {
    return null;
  }
}
