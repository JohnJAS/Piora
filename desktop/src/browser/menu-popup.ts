import { BrowserWindow, ipcMain, screen, type IpcMainEvent } from "electron";
import { join } from "node:path";
import type { MenuChoice } from "./contracts.js";

const channel = "pi:browser-popup-input";
const choices = new Set<MenuChoice>([
  "find",
  "print",
  "device",
  "deviceDefault",
  "screenshot",
  "import",
  "vault",
  "contacts",
  "downloads",
  "history",
  "privacy",
  "settings",
]);
export interface MenuModel {
  x: number;
  y: number;
  locale: string;
  dark: boolean;
  page: boolean;
  hasTab: boolean;
  device: boolean;
  defaultDevice: boolean;
  zoom: number;
  minZoom: boolean;
  maxZoom: boolean;
}
export class BrowserMenuPopup {
  private window: BrowserWindow | undefined;
  close() {
    this.window?.close();
  }
  show(
    parent: BrowserWindow,
    model: MenuModel,
    isCurrent: () => boolean,
    zoom: (direction: "zoom_in" | "zoom_out" | "zoom_reset") => {
      zoom: number;
      minZoom: boolean;
      maxZoom: boolean;
    },
  ): Promise<MenuChoice | null> {
    this.close();
    const anchor = parent.getContentBounds();
    const scale = parent.webContents.getZoomFactor();
    const point = { x: Math.round(anchor.x + model.x * scale), y: Math.round(anchor.y + model.y * scale) };
    const work = screen.getDisplayNearestPoint(point).workArea;
    const width = Math.min(240, Math.floor(work.width / 2));
    const height = Math.min(390, work.height);
    const x = Math.max(work.x, Math.min(work.x + work.width - width, point.x - width));
    const y = Math.max(work.y, Math.min(work.y + work.height - height, point.y + 4));
    const left = x - width >= work.x;
    const popup = new BrowserWindow({
      parent,
      x,
      y,
      width,
      height,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      transparent: true,
      hasShadow: true,
      backgroundColor: "#00000000",
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        preload: join(__dirname, "menu-preload.js"),
      },
    });
    this.window = popup;
    popup.removeMenu();
    popup.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    popup.webContents.on("will-navigate", (event) => event.preventDefault());
    return new Promise((resolve, reject) => {
      let selected: MenuChoice | null = null;
      const close = () => popup.close();
      const interact = (event: IpcMainEvent, value: unknown) => {
        if (event.sender !== popup.webContents || event.senderFrame !== popup.webContents.mainFrame) return;
        if (!isCurrent() || value === "close") {
          close();
          return;
        }
        if (value === "collapse") {
          if (process.platform === "win32") popup.setShape([]);
          popup.setBounds({ x, y, width, height });
        } else if (value && typeof value === "object" && "submenuTop" in value && "submenuHeight" in value) {
          const top = Number(value.submenuTop),
            subHeight = Number(value.submenuHeight);
          if (
            !Number.isSafeInteger(top) ||
            !Number.isSafeInteger(subHeight) ||
            top < 0 ||
            subHeight < 1 ||
            top + subHeight > height
          )
            return;
          const expandedX = Math.min(work.x + work.width - 2 * width, Math.max(work.x, left ? x - width : x));
          popup.setBounds({ x: expandedX, y, height, width: 2 * width });
          if (process.platform === "win32")
            popup.setShape([
              { x: left ? width : 0, y: 0, width, height },
              { x: left ? 0 : width, y: top, width, height: subHeight },
            ]);
        } else if (value === "zoom_in" || value === "zoom_out" || value === "zoom_reset") {
          if (model.page) popup.webContents.send("pi:browser-popup-zoom", zoom(value));
        } else if (typeof value === "string" && choices.has(value as MenuChoice)) {
          selected = value as MenuChoice;
          close();
        }
      };
      ipcMain.on(channel, interact);
      popup.once("closed", () => {
        ipcMain.off(channel, interact);
        parent.off("move", close);
        parent.off("resize", close);
        if (this.window === popup) this.window = undefined;
        resolve(selected);
      });
      parent.on("move", close);
      parent.on("resize", close);
      popup.on("blur", close);
      popup.webContents.once("did-finish-load", () => {
        if (popup.isDestroyed() || !isCurrent()) {
          if (!popup.isDestroyed()) close();
          return;
        }
        popup.webContents.send("pi:browser-popup-ready", { ...model, left, width });
        popup.show();
        popup.focus();
      });
      void popup.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(menuHtml)).catch((error) => {
        if (popup.isDestroyed()) return;
        reject(error);
        close();
      });
    });
  }
}

const menuHtml = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Piora Browser Menu</title><style>
*{box-sizing:border-box}html,body{margin:0;background:transparent}body{font:14px/1.3 "Segoe UI","Microsoft YaHei UI",sans-serif;color:var(--fg);--bg:#fcfcfd;--fg:#25262a;--muted:#777980;--line:#e4e4e7;--row:#f0f0f2;--control:#f2f2f4;color-scheme:light}
body.dark{--bg:#252528;--fg:#f1f1f3;--muted:#a7a7ad;--line:#3c3c40;--row:#343438;--control:#303034;color-scheme:dark}
main{display:flex;height:100vh}section{flex:none;min-width:0;overflow:auto;background:var(--bg);border:1px solid var(--line);border-radius:15px;padding:4px;scrollbar-width:thin}
button{display:flex;align-items:center;justify-content:space-between;width:100%;height:32px;padding:0 7px;border:0;border-radius:9px;background:transparent;color:inherit;font:inherit;text-align:start;white-space:nowrap;cursor:default}
button:focus{outline:0}button:hover:enabled,.using-keys button:focus-visible,button[aria-expanded=true]{background:var(--row);outline:0}button:disabled{color:var(--muted);opacity:.52}
hr{margin:3px 7px;border:0;border-top:1px solid var(--line)}[data-sub] svg{color:var(--muted)}
.zoom{display:flex;align-items:center;gap:5px;height:32px;padding:0 7px}.zoom>span{flex:1}
.zoom .stepper{display:inline-flex;align-items:center;height:25px;border-radius:8px;border:1px solid var(--line);background:var(--control);overflow:hidden}
.stepper button{width:23px;height:23px;justify-content:center;padding:0;border-radius:0;font-size:13px;line-height:1}.stepper button+button{border-left:1px solid var(--line)}.stepper button[data-action=zoom_reset]{width:43px;font-variant-numeric:tabular-nums;font-size:12px}.zoom>button{width:23px;height:25px;justify-content:center;padding:0;color:var(--muted)}
.sub{align-self:flex-start}button[aria-checked=true]::after{content:'✓';color:var(--fg)}
</style></head><body><main></main></body></html>`;
