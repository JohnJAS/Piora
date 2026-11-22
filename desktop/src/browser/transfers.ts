import { mkdirSync, existsSync } from "node:fs";
import { shell, type DownloadItem, type Event } from "electron";
import { BrowserLibrary } from "./library.js";
import { browserDownloadPath, type BrowserDownloadPreferences } from "../browser-preferences.js";
import type { BrowserQuery, Transfer, TransferAction, TransferState } from "./contracts.js";

type Live = {
  item: DownloadItem;
  state: TransferState;
  lastWrite: number;
  received: number;
  total: number;
  path: string;
  reserved?: string;
};
export class BrowserTransfers {
  private readonly live = new Map<number, Live>();
  private readonly paths = new Set<string>();
  private closed = false;
  constructor(
    private readonly store: BrowserLibrary,
    private readonly preferences: () => BrowserDownloadPreferences,
    private readonly changed: (row: Transfer) => void,
  ) {}

  start(event: Event, item: DownloadItem) {
    const filename = item.getFilename();
    const id = this.store.startDownload(filename, item.getURL());
    const entry: Live = { item, state: "progressing", lastWrite: 0, received: 0, total: 0, path: "" };
    this.live.set(id, entry);
    try {
      const { effectiveDirectory, askEachTime } = this.preferences();
      mkdirSync(effectiveDirectory, { recursive: true });
      const destination = browserDownloadPath(effectiveDirectory, filename, this.paths);
      if (askEachTime) item.setSaveDialogOptions({ defaultPath: destination });
      else {
        item.setSavePath(destination);
        entry.reserved = destination;
        this.paths.add(destination);
      }
    } catch {
      event.preventDefault();
      this.live.delete(id);
      this.store.updateDownload(id, "", 0, 0, "interrupted", Date.now());
      this.changed(this.store.describe(this.store.transfer(id)!, false, false));
      return;
    }
    const update = (state: TransferState, terminal = false) => {
      if (this.closed) return;
      const now = Date.now();
      const previous = entry.state;
      entry.state = state === "progressing" && item.isPaused() ? "paused" : state;
      entry.received = item.getReceivedBytes();
      entry.total = item.getTotalBytes();
      entry.path = item.getSavePath();
      if (!terminal && entry.state === previous && now - entry.lastWrite < 200) return;
      entry.lastWrite = now;
      if (terminal) {
        this.live.delete(id);
        if (entry.reserved) this.paths.delete(entry.reserved);
      }
      this.store.updateDownload(id, entry.path, entry.received, entry.total, entry.state, terminal ? now : null);
      const row = this.store.transfer(id);
      if (row) this.changed(this.store.describe(row, !terminal, !terminal && item.canResume()));
    };
    update("progressing");
    item.on("updated", (_event, state) => update(state));
    item.once("done", (_event, state) => update(state, true));
  }

  activity(): Transfer | null {
    const id = [...this.live.keys()].at(-1);
    if (id === undefined) return null;
    const item = this.live.get(id)!;
    const row = this.store.transfer(id);
    return row
      ? this.store.describe(
          { ...row, received: item.received, total: item.total, state: item.state },
          true,
          item.item.canResume(),
        )
      : null;
  }
  list(query: BrowserQuery) {
    return this.store.downloads(query).map((row) => {
      const live = this.live.get(row.id);
      return this.store.describe(
        live ? { ...row, state: live.state, received: live.received, total: live.total, path: live.path } : row,
        Boolean(live),
        Boolean(live?.item.canResume()),
      );
    });
  }
  async action(id: number, action: TransferAction) {
    const row = this.store.transfer(id);
    if (!row) throw new Error("Download no longer exists");
    const live = this.live.get(id);
    switch (action) {
      case "pause":
      case "resume": {
        if (!live || (action === "resume" && !live.item.canResume()))
          throw new Error("Download cannot be resumed or paused");
        if (action === "pause") live.item.pause();
        else live.item.resume();
        live.state = live.item.isPaused() ? "paused" : "progressing";
        this.store.updateDownload(
          id,
          live.item.getSavePath(),
          live.item.getReceivedBytes(),
          live.item.getTotalBytes(),
          live.state,
          null,
        );
        this.changed(this.store.describe(this.store.transfer(id)!, true, live.item.canResume()));
        return;
      }
      case "cancel":
        if (!live) throw new Error("Download already finished");
        live.item.cancel();
        return;
      case "remove":
        if (live) throw new Error("Stop the download before removing it");
        this.store.deleteTransfer(id);
        return;
      case "reveal":
      case "open":
        if (row.state !== "completed" || !row.path || !existsSync(row.path))
          throw new Error("Downloaded file is missing");
        if (action === "reveal") shell.showItemInFolder(row.path);
        else if (await shell.openPath(row.path)) throw new Error("Unable to open the downloaded file");
        return;
      default:
        throw new Error("Unknown download action");
    }
  }
  close() {
    this.closed = true;
    this.live.clear();
    this.paths.clear();
  }
}
