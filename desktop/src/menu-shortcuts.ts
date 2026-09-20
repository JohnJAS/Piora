import type { MenuItemConstructorOptions } from "electron";

const SYMBOL_KEYS = new Set([",", ".", "/", ";", "'", "[", "]", "\\", "-", "=", "`"]);

/** Windows translates punctuation accelerator names using the OS language. */
export function withSymbolicMenuShortcuts(
  template: MenuItemConstructorOptions[],
  platform: string,
): MenuItemConstructorOptions[] {
  if (platform !== "win32") return template;
  return template.flatMap((item): MenuItemConstructorOptions[] => {
    if (Array.isArray(item.submenu)) {
      return [{ ...item, submenu: withSymbolicMenuShortcuts(item.submenu, platform) }];
    }
    const key = item.accelerator?.split("+").at(-1);
    if (!key || !SYMBOL_KEYS.has(key) || !item.label || item.role || item.visible === false) return [item];
    const shortcut = item.accelerator!.replace(/CommandOrControl|CmdOrCtrl/g, "Ctrl");
    // Keep the native binding registered on a hidden item. The visible action
    // uses literal symbols so Chromium cannot localize the key name again.
    const visibleItem = { ...item, label: `${item.label} (${shortcut})` };
    delete visibleItem.accelerator;
    const bindingItem = { ...item, visible: false };
    delete bindingItem.id;
    return [
      visibleItem,
      bindingItem,
    ];
  });
}
