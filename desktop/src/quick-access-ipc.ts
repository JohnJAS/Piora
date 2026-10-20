import { app, clipboard, dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { QuickAccessError, QuickAccessStore, type QuickAccessEnvironment } from "./quick-access-store.js";
import { launchHostsEditor, openQuickAccess } from "./quick-access-open.js";
import { pickQuickAccessFile } from "./quick-access-pick.js";

export function registerQuickAccessHandlers(options: {
  owner: (event: IpcMainInvokeEvent) => BrowserWindow | null;
  windows: () => BrowserWindow[];
  nativeDialog: <T>(owner: BrowserWindow, task: () => Promise<T>) => Promise<T>;
  pickFile?: typeof pickQuickAccessFile;
}): void {
  const environment: QuickAccessEnvironment = {
    platform: process.platform,
    systemRoot: process.env.SystemRoot || "C:\\Windows",
    folders: { downloads: app.getPath("downloads"), desktop: app.getPath("desktop"), documents: app.getPath("documents") },
  };
  const store = new QuickAccessStore(app.getPath("userData"), environment);
  const handlers: Record<string, (owner: BrowserWindow, ...args: unknown[]) => unknown> = {
    list: () => store.list(),
    mutate: async (_owner, input) => {
      const snapshot = await store.mutate(input);
      for (const window of options.windows()) if (!window.isDestroyed()) window.webContents.send("pi:quick-access-change");
      return snapshot;
    },
    pick: async (owner, kind) => {
      if (kind !== "file" && kind !== "folder") throw new QuickAccessError("invalidInput");
      return options.nativeDialog(owner, async () => {
        const zh = app.getLocale().toLowerCase().startsWith("zh");
        const title = zh ? kind === "file" ? "选择文件或快捷方式" : "选择常用文件夹" : kind === "file" ? "Choose a file or shortcut" : "Choose a folder";
        if (kind === "file" && process.platform === "win32") return (options.pickFile ?? pickQuickAccessFile)(owner, environment.systemRoot, title);
        const result = await dialog.showOpenDialog(owner, {
          title,
          properties: kind === "file" ? ["openFile", "noResolveAliases"] : ["openDirectory"],
        });
        return result.canceled ? null : result.filePaths[0] ?? null;
      });
    },
    open: (owner, id, action = "open") => {
      const open = () => openQuickAccess(store, environment, {
        openPath: target => shell.openPath(target),
        reveal: target => shell.showItemInFolder(target),
        copy: target => clipboard.writeText(target),
        hostsEditor: elevated => launchHostsEditor(environment.systemRoot, elevated),
      }, id, action);
      if (action !== "edit-admin") return open();
      return options.nativeDialog(owner, async () => {
        try {
          const result = await open();
          if (result.status === "cancelled" && !owner.isDestroyed()) { owner.show(); owner.focus(); }
          return result;
        } catch (cause) {
          if (!owner.isDestroyed()) { owner.show(); owner.focus(); }
          throw cause;
        }
      });
    },
  };
  for (const [name, handler] of Object.entries(handlers)) {
    const channel = `pi:quick-access-${name}`;
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      const owner = options.owner(event);
      if (!owner || owner.isDestroyed()) throw new Error("Untrusted quick access request");
      return handler(owner, ...args);
    });
  }
}
