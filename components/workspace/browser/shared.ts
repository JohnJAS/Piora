import { useI18n } from "@/hooks/useI18n";
import type { BrowserSection, BrowserToolsEvent, BrowserToolInvoke } from "@/desktop/src/browser/contracts";

export interface ToolsBridge {
  tools: BrowserToolInvoke;
  onToolsEvent?: (callback: (event: BrowserToolsEvent) => void) => () => void;
}
export function useBrowserCopy() {
  const { locale } = useI18n();
  return { locale, copy: (zh: string, en: string) => (locale === "zh-CN" ? zh : en) };
}
export const sectionLabels: Record<BrowserSection, [string, string]> = {
  history: ["历史记录", "History"],
  downloads: ["下载", "Downloads"],
  contacts: ["联系人信息", "Contact info"],
  import: ["导入 Cookie 和密码", "Import cookies and passwords"],
  privacy: ["清除浏览数据", "Clear browsing data"],
  devices: ["显示与设备", "Display and devices"],
};
export const errorText = (error: unknown) => {
  const message = (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i,
    "",
  );
  if (/Browser tab changed|Render frame was disposed/i.test(message))
    return document.documentElement.lang.startsWith("en")
      ? "The tab changed. Try again on the current page."
      : "网页已切换，请在当前标签页重试。";
  return message;
};
export type BrowserSettingsPage =
  | "browser"
  | "passwordManager"
  | "vault"
  | "history"
  | "downloads"
  | "contacts"
  | "devices";
export function openBrowserSettings(destination: BrowserSettingsPage) {
  window.dispatchEvent(new CustomEvent("piora:browser-settings", { detail: destination }));
}
export function reopenFromSettings(url: string) {
  window.dispatchEvent(new CustomEvent("piora:browser-history-open", { detail: url }));
}
