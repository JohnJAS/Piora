// A packaged identity; never selected from the end user's environment.
export { APP_BRAND, APP_DISPLAY_NAME } from "./generated/brand.js";
import { APP_DISPLAY_NAME } from "./generated/brand.js";

export function brandText(copy: string): string {
  return copy.replaceAll("Piora", APP_DISPLAY_NAME).replaceAll("PIORA", APP_DISPLAY_NAME.toUpperCase());
}
