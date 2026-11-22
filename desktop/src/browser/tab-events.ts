import type { WebContents } from "electron";
import type { BrowserTarget, BrowserToolsEvent } from "./contracts.js";
import type { BrowserLibrary } from "./library.js";
import type { BrowserPageTools } from "./page-tools.js";

export interface TabToolHost {
  current(): boolean;
  recordable(): boolean;
  focusHost(): void;
  error(value: unknown): void;
}

export function bindTabTools(
  contents: WebContents,
  target: BrowserTarget,
  host: TabToolHost,
  library: BrowserLibrary,
  pages: BrowserPageTools,
  emit: (event: BrowserToolsEvent) => void,
) {
  let visit: number | null = null;
  let committed = "";
  let failedDocument = false;
  const changed = () => emit({ kind: "library", section: "history" });
  const record = (url: string, inPage: boolean) => {
    if (inPage && (failedDocument || committed === url)) return;
    committed = url;
    visit = host.recordable() ? library.visit(url, inPage ? contents.getTitle() : "", "navigation") : null;
    if (visit !== null) changed();
  };
  contents.on("did-navigate", (_event, url, response) => {
    failedDocument = response >= 400;
    visit = null;
    committed = "";
    if (!failedDocument) record(url, false);
  });
  contents.on("did-fail-load", (_event, code, _description, _url, mainFrame) => {
    if (mainFrame && code !== -3) {
      failedDocument = true;
      visit = null;
    }
  });
  contents.on("did-navigate-in-page", (_event, url, mainFrame) => {
    if (mainFrame) record(url, true);
  });
  const title = (value: string) => {
    if (visit !== null && host.recordable() && committed === contents.getURL() && value) {
      library.title(visit, value);
      changed();
    }
  };
  contents.on("page-title-updated", (_event, value) => title(value));
  contents.on("did-finish-load", () => title(contents.getTitle()));
  pages.bind(contents, target, host.current);
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !(input.control || input.meta) || input.alt || input.shift || !host.current())
      return;
    const key = input.key.toLowerCase();
    if (!["f", "p", "h", "j"].includes(key)) return;
    event.preventDefault();
    if (key === "p") {
      if (host.recordable()) void pages.print(contents).catch(host.error);
      return;
    }
    host.focusHost();
    emit({ kind: "shortcut", target, action: key === "f" ? "find" : key === "j" ? "downloads" : "history" });
  });
}
