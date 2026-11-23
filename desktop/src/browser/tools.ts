import { join } from "node:path";
import {
  app,
  ipcMain,
  safeStorage,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type Session,
  type WebContents,
} from "electron";
import { BrowserLibrary } from "./library.js";
import { BrowserTransfers } from "./transfers.js";
import { BrowserPrivacy } from "./privacy.js";
import { BrowserContacts } from "./contacts.js";
import { importSources, openImportSource } from "./import-sources.js";
import { BrowserProfileImport } from "./profile-import.js";
import { BrowserDevices } from "./devices.js";
import { BrowserPageTools } from "./page-tools.js";
import { bindTabTools, type TabToolHost } from "./tab-events.js";
import { BrowserMenuPopup } from "./menu-popup.js";
import { BrowserModal } from "./modal.js";
import { MAX_BROWSER_ZOOM, MIN_BROWSER_ZOOM, type BrowserDownloadPreferences } from "../browser-preferences.js";
import type { CredentialVault } from "../credential-vault.js";
import type { BrowserPermissions } from "../browser-permissions.js";
import type {
  BrowserContact,
  BrowserEndpoints,
  BrowserTarget,
  BrowserToolsEvent,
  ClearOptions,
  DeviceViewport,
  ImportKind,
  ImportSelection,
  Transfer,
  TransferAction,
  BrowserQuery,
} from "./contracts.js";

export interface LocatedPage {
  contents: WebContents;
  protected: boolean;
  current: () => boolean;
  focusIfVisible: () => void;
}
interface Host {
  window: BrowserWindow;
  session: Session;
  trusted(event: IpcMainInvokeEvent): boolean;
  locate(target: BrowserTarget): LocatedPage;
  empty(target: BrowserTarget): boolean;
  zoom(target: BrowserTarget, action: "zoom_in" | "zoom_out" | "zoom_reset"): void;
  viewportChanged(): void;
  preferences(): BrowserDownloadPreferences;
  permissions(): BrowserPermissions;
  clearSites(): Promise<void>;
  writeSites<T>(operation: () => Promise<T>): Promise<T>;
  vault(): CredentialVault;
  download(row: Transfer): void;
}
const channel = "pi:browser-tools";
export class BrowserTools {
  readonly library: BrowserLibrary;
  readonly transfers: BrowserTransfers;
  readonly devices: BrowserDevices;
  readonly pages: BrowserPageTools;
  readonly popup = new BrowserMenuPopup();
  private readonly modal = new BrowserModal();
  private readonly contacts: BrowserContacts;
  private readonly imports: BrowserProfileImport;
  private readonly privacy: BrowserPrivacy;
  private menuOwner: BrowserTarget | undefined;
  private registering = false;
  private closed = false;
  constructor(private readonly host: Host) {
    const directory = join(app.getPath("userData"), "piora-browser");
    this.library = new BrowserLibrary(join(directory, "library.sqlite"));
    this.devices = new BrowserDevices(() => this.library.deviceDefault());
    this.contacts = new BrowserContacts(join(directory, "contacts.enc"), safeStorage);
    this.imports = new BrowserProfileImport(
      host.window,
      host.session,
      host.vault,
      host.writeSites,
      this.library,
      () => this.changed("history"),
    );
    this.transfers = new BrowserTransfers(this.library, host.preferences, (row) => {
      host.download(row);
      this.changed("downloads");
    });
    this.pages = new BrowserPageTools((event) => this.notify(event));
    this.privacy = new BrowserPrivacy(
      this.library,
      this.contacts,
      host.session,
      host.permissions,
      host.clearSites,
    );
  }
  bindTab(contents: WebContents, target: BrowserTarget, host: TabToolHost) {
    bindTabTools(contents, target, host, this.library, this.pages, (event) => this.notify(event));
  }
  register() {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (event, command: keyof BrowserEndpoints, value: unknown) => {
      if (!this.host.trusted(event) || this.closed) throw new Error("Untrusted browser request");
      return this.dispatch(command, value);
    });
    this.registering = true;
  }
  notify(event: BrowserToolsEvent) {
    const window = this.host.window;
    if (!this.closed && !window.isDestroyed() && !window.webContents.isDestroyed())
      window.webContents.send("pi:browser-tools-event", event);
  }
  changed(section: "history" | "downloads" | "contacts" | "devices") {
    if (section === "downloads") this.modal.notifyDownloads();
    this.notify({ kind: "library", section });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.registering) ipcMain.removeHandler(channel);
    this.popup.close();
    this.modal.close();
    this.imports.close();
    this.transfers.close();
    this.library.close();
  }
  private async dispatch(
    command: keyof BrowserEndpoints,
    value: unknown,
    owner = this.host.window,
  ): Promise<unknown> {
    const input = (value ?? {}) as Record<string, unknown>;
    const id = () => {
      if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error("Invalid record ID");
      return Number(value);
    };
    const target = input.target as BrowserTarget;
    const page = () => this.host.locate(target);
    switch (command) {
      case "recent":
        if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) throw new Error("Invalid menu anchor");
        return this.modal.show(
          this.host.window,
          "recent",
          (action, args, dialog) => this.dispatch(action as keyof BrowserEndpoints, args, dialog),
          { x: Number(input.x), y: Number(input.y) },
        );
      case "modal":
        if (value !== "import" && value !== "privacy") throw new Error("Invalid dialog");
        return this.modal.show(this.host.window, value, (action, input, dialog) =>
          this.dispatch(action as keyof BrowserEndpoints, input, dialog),
        );
      case "menu": {
        const opened = this.host.empty(target) ? undefined : page();
        if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) throw new Error("Invalid menu anchor");
        const zoom = () => ({
          zoom: opened?.contents.getZoomFactor() ?? 1,
          minZoom: (opened?.contents.getZoomLevel() ?? 0) <= MIN_BROWSER_ZOOM,
          maxZoom: (opened?.contents.getZoomLevel() ?? 0) >= MAX_BROWSER_ZOOM,
        });
        this.menuOwner = target;
        return this.popup
          .show(
            this.host.window,
            {
              x: Number(input.x),
              y: Number(input.y),
              locale: String(input.locale),
              dark: input.dark === true,
              page: Boolean(opened && opened.contents.getURL() !== "about:blank" && !opened.protected),
              hasTab: Boolean(opened),
              device: Boolean(opened && this.devices.get(target.tabId).enabled),
              defaultDevice: this.library.deviceDefault(),
              ...zoom(),
            },
            opened?.current ?? (() => this.host.empty(target)),
            (action) => {
              this.host.zoom(target, action);
              return zoom();
            },
          )
          .finally(() => {
            if (this.menuOwner === target) this.menuOwner = undefined;
          });
      }
      case "dismissMenu":
        if (
          this.menuOwner &&
          input.sessionId === this.menuOwner.sessionId &&
          input.tabId === this.menuOwner.tabId &&
          input.navigationEpoch === this.menuOwner.navigationEpoch
        )
          this.popup.close();
        return;
      case "page": {
        const current = page();
        if (current.protected) throw new Error("请先完成当前凭据填写");
        if (input.action === "print") {
          current.focusIfVisible();
          return this.pages.print(current.contents).finally(current.focusIfVisible);
        }
        if (input.action === "screenshot")
          return this.pages.screenshot(current.contents, () => current.current() && !page().protected);
        throw new Error("Invalid page action");
      }
      case "find":
        return this.pages.find(
          page().contents,
          input.query as string,
          input.direction as "next" | "previous" | undefined,
        );
      case "history":
        return this.library.history(input as BrowserQuery);
      case "deleteVisit":
        this.library.deleteVisit(id());
        this.changed("history");
        return;
      case "downloads":
        return this.transfers.list(input as BrowserQuery);
      case "downloadActivity":
        return this.transfers.activity();
      case "transfer": {
        if (!Number.isSafeInteger(input.id)) throw new Error("Invalid download ID");
        await this.transfers.action(Number(input.id), input.action as TransferAction);
        this.changed("downloads");
        return;
      }
      case "device": {
        page();
        if (input.viewport !== undefined) {
          this.devices.set(target.tabId, input.viewport as DeviceViewport);
          this.host.viewportChanged();
        }
        return this.devices.get(target.tabId);
      }
      case "deviceDefault":
        if (value !== null && typeof value !== "boolean") throw new Error("Invalid device preference");
        return this.library.deviceDefault(value ?? undefined);
      case "contacts":
        return this.contacts.list();
      case "saveContact":
        this.contacts.save(input as unknown as BrowserContact);
        this.changed("contacts");
        return;
      case "deleteContact":
        this.contacts.remove(String(value));
        this.changed("contacts");
        return;
      case "fillContact": {
        const current = page(),
          contact = this.contacts.list().find((row) => row.id === input.id);
        if (!contact || current.protected) throw new Error("无法填入当前网页");
        return this.pages.fill(current.contents, contact, current.current);
      }
      case "openImportSource":
        if (typeof value !== "string" || owner === this.host.window) throw new Error("请从导入窗口选择个人资料。");
        return openImportSource(value);
      case "importSources":
        return importSources();
      case "importChoose":
        return this.imports.choose(value as ImportKind | ImportSelection, owner);
      case "importApply":
        return this.imports.apply(String(input.token), input.replace === true, input.sites as string[]);
      case "importCancel":
        this.imports.cancel(String(value));
        return;
      case "clearPreview":
        return this.privacy.preview(value as ClearOptions);
      case "clearApply": {
        const result = await this.privacy.apply(String(value));
        for (const key of result.done)
          if (key === "history" || key === "downloads" || key === "contacts") this.changed(key);
        return result;
      }
      default:
        throw new Error("Unknown browser command");
    }
  }
}
