import { BrowserWindow, screen } from "electron";
import { join } from "node:path";
import type { BrowserDialogKind } from "./contracts.js";

const channel = "pi:browser-modal";
const commands = {
  recent: new Set(["downloads", "transfer"]),
  import: new Set(["importChoose", "importApply", "importCancel"]),
  privacy: new Set(["clearPreview", "clearApply"]),
};

export class BrowserModal {
  private window: BrowserWindow | undefined;

  close() {
    this.window?.close();
  }

  notifyDownloads() {
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send("pi:browser-modal-refresh");
  }

  show(
    parent: BrowserWindow,
    kind: BrowserDialogKind | "recent",
    dispatch: (command: string, input: unknown, owner: BrowserWindow) => Promise<unknown>,
    anchor?: { x: number; y: number },
  ) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.focus();
      return Promise.resolve(null);
    }
    const target = new URL("/desktop-browser-dialog", parent.webContents.getURL());
    if (!["http:", "https:"].includes(target.protocol)) throw new Error("Browser dialog unavailable");
    target.searchParams.set("section", kind);
    let panelHeight = 160;
    const bounds = () => {
      const bounds = parent.getContentBounds();
      if (!anchor) return bounds;
      const zoom = parent.webContents.getZoomFactor();
      const point = { x: Math.round(bounds.x + anchor.x * zoom), y: Math.round(bounds.y + anchor.y * zoom) };
      const work = screen.getDisplayNearestPoint(point).workArea;
      const width = Math.min(356, work.width),
        height = Math.min(panelHeight, work.height);
      return {
        x: Math.max(work.x, Math.min(work.x + work.width - width, point.x - width)),
        y: Math.max(work.y, Math.min(work.y + work.height - height, point.y + 4)),
        width,
        height,
      };
    };
    const window = new BrowserWindow({
      ...bounds(),
      parent,
      modal: !anchor,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      show: false,
      skipTaskbar: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      resizable: false,
      movable: false,
      webPreferences: {
        session: parent.webContents.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        preload: join(__dirname, "modal-preload.js"),
      },
    });
    this.window = window;
    window.removeMenu();
    const fit = () => {
      if (!window.isDestroyed() && !parent.isDestroyed()) window.setBounds(bounds());
    };
    // A native child keeps the live Chromium page visible behind the dimmed dialog.
    return new Promise<"vault" | "downloads" | null>((resolve, reject) => {
      let destination: "vault" | "downloads" | null = null;
      const tokens = new Set<string>();
      const finish = () => window.close();
      if (anchor) window.on("blur", finish);
      parent.on("resize", fit);
      parent.on("move", fit);
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      window.webContents.ipc.handle(channel, async (event, command: string, input: unknown) => {
        if (
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame ||
          event.senderFrame.url !== target.href
        )
          throw new Error("Invalid dialog");
        if (command === "ready") {
          fit();
          window.show();
          return;
        }
        if (command === "height" && anchor && Number.isFinite(input)) {
          panelHeight = Math.min(440, Math.max(80, Math.ceil(Number(input))));
          fit();
          return;
        }
        if (command === "close") {
          destination =
            input === "vault" && kind === "import"
              ? "vault"
              : input === "downloads" && kind === "recent"
                ? "downloads"
                : null;
          finish();
          return;
        }
        if (!commands[kind].has(command)) throw new Error("Invalid dialog action");
        let token = "";
        if (command === "importApply" || command === "importCancel" || command === "clearApply") {
          token = typeof input === "string" ? input : String((input as { token?: string })?.token || "");
          if (!tokens.has(token)) throw new Error("Preview expired");
          tokens.delete(token);
        }
        const value = await dispatch(command, input, window);
        if (value && typeof value === "object" && "token" in value && typeof value.token === "string") {
          if (!window.isDestroyed()) tokens.add(value.token);
          else if (kind === "import") await dispatch("importCancel", value.token, window);
        }
        return value;
      });
      window.once("closed", () => {
        parent.off("resize", fit);
        parent.off("move", fit);

        for (const token of tokens)
          if (kind === "import") void dispatch("importCancel", token, window).catch(() => {});
        if (this.window === window) this.window = undefined;
        resolve(destination);
      });
      window.webContents.once("render-process-gone", finish);
      void window.loadURL(target.href).catch((error) => {
        if (!window.isDestroyed()) {
          reject(error);
          finish();
        }
      });
    });
  }
}
