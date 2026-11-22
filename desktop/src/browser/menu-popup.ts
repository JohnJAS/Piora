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
    const width = Math.min(232, Math.floor(work.width / 2));
    const height = Math.min(416, work.height);
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
      backgroundColor: model.dark ? "#202124" : "#ffffff",
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
*{box-sizing:border-box}body{margin:0;background:var(--bg);font:14px "Segoe UI",sans-serif;color:var(--fg);--bg:#fff;--fg:#252629;--line:#ddd;--hover:#eef0f3;color-scheme:light}body.dark{--bg:#202124;--fg:#eee;--line:#505154;--hover:#353638;color-scheme:dark}
main{display:flex;height:100vh}section{flex:none;min-width:0;overflow:auto;padding:5px;border:1px solid var(--line);background:var(--bg)}button{font:inherit;color:inherit;background:none;border:0;text-align:left;border-radius:4px;width:100%;padding:6px 9px;cursor:pointer}button:hover,button:focus-visible{background:var(--hover);outline:none}button:disabled{opacity:.45;cursor:default}button[data-sub]::after{content:'›';float:right}hr{border:0;border-top:1px solid var(--line);margin:4px}.zoom{display:flex;align-items:center;padding:3px 7px;gap:4px}.zoom span{flex:1}.zoom button{width:auto;text-align:center;padding:4px}.sub{align-self:flex-start}button[aria-checked=true]::before{content:'✓ '}</style></head><body><main></main></body></html>`;
