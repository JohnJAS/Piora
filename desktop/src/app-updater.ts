import type { AppUpdater } from "electron-updater";
import type { Logger } from "./logger.js";

export type DesktopUpdateStatus =
  | "unsupported"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export interface DesktopUpdateState {
  status: DesktopUpdateStatus;
  currentVersion: string;
  availableVersion?: string;
  progressPercent?: number;
  error?: string;
}

export type DesktopUpdateListener = (state: Readonly<DesktopUpdateState>) => void;

function normalizedVersion(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/^v/i, "");
  return trimmed || undefined;
}

function normalizedError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export class DesktopUpdateController {
  private state: DesktopUpdateState;
  private readonly listeners = new Set<DesktopUpdateListener>();
  private checkPromise: Promise<void> | undefined;
  private downloadPromise: Promise<void> | undefined;

  constructor(
    private readonly updater: AppUpdater | null,
    currentVersion: string,
    private readonly logger: Logger,
  ) {
    this.state = {
      status: updater ? "idle" : "unsupported",
      currentVersion: normalizedVersion(currentVersion) ?? currentVersion,
    };

    if (!updater) return;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.autoRunAppAfterInstall = true;
    updater.allowPrerelease = false;
    updater.logger = logger;

    updater.on("checking-for-update", () => {
      this.publish({ status: "checking" });
    });
    updater.on("update-not-available", () => {
      this.publish({ status: "up-to-date" });
    });
    updater.on("update-available", (info) => {
      const availableVersion = normalizedVersion(info.version);
      this.publish({
        status: "available",
        ...(availableVersion ? { availableVersion } : {}),
      });
    });
    updater.on("download-progress", (progress) => {
      this.publish({
        status: "downloading",
        progressPercent: Math.max(0, Math.min(100, Math.round(progress.percent))),
      });
    });
    updater.on("update-downloaded", (info) => {
      const availableVersion = normalizedVersion(info.version);
      this.publish({
        status: "downloaded",
        ...(availableVersion ? { availableVersion } : {}),
        progressPercent: 100,
      });
    });
    updater.on("update-cancelled", (info) => {
      const availableVersion = normalizedVersion(info.version);
      this.publish({
        status: "available",
        ...(availableVersion ? { availableVersion } : {}),
      });
    });
    updater.on("error", (error) => {
      this.fail(error);
    });
  }

  getState(): Readonly<DesktopUpdateState> {
    return { ...this.state };
  }

  subscribe(listener: DesktopUpdateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  async checkForUpdates(): Promise<void> {
    if (!this.updater || this.downloadPromise) return;
    if (this.checkPromise) return this.checkPromise;

    this.publish({ status: "checking" });
    this.checkPromise = this.updater.checkForUpdates()
      .then(() => undefined)
      .catch((error: unknown) => this.fail(error))
      .finally(() => {
        this.checkPromise = undefined;
      });
    return this.checkPromise;
  }

  async downloadUpdate(): Promise<void> {
    if (!this.updater || this.state.status !== "available") return;
    if (this.downloadPromise) return this.downloadPromise;

    this.publish({ status: "downloading", progressPercent: 0 });
    this.downloadPromise = this.updater.downloadUpdate()
      .then(() => undefined)
      .catch((error: unknown) => this.fail(error))
      .finally(() => {
        this.downloadPromise = undefined;
      });
    return this.downloadPromise;
  }

  quitAndInstall(): boolean {
    if (!this.updater || this.state.status !== "downloaded") return false;
    this.updater.quitAndInstall(false, true);
    return true;
  }

  private fail(error: unknown): void {
    const message = normalizedError(error);
    this.logger.error("Desktop update failed", error);
    this.publish({ status: "error", error: message });
  }

  private publish(next: Omit<DesktopUpdateState, "currentVersion">): void {
    const keepsAvailableVersion = next.status === "available"
      || next.status === "downloading"
      || next.status === "downloaded";
    const availableVersion = next.availableVersion
      ?? (keepsAvailableVersion ? this.state.availableVersion : undefined);
    this.state = {
      status: next.status,
      currentVersion: this.state.currentVersion,
      ...(availableVersion ? { availableVersion } : {}),
      ...(next.progressPercent === undefined ? {} : { progressPercent: next.progressPercent }),
      ...(next.error ? { error: next.error } : {}),
    };
    const snapshot = this.getState();
    this.logger.info("Desktop update state changed", snapshot);
    for (const listener of this.listeners) listener(snapshot);
  }
}
