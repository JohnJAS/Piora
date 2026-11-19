import { DSH_PET_VERSION, type DshPetAction, type DshPetProgress, type DshPetStatus } from "./dsh-pet-types.js";
import { DSH_PET_INTEGRITY } from "./dsh-pet-install.js";
import { DSH_MEME_INTEGRITY, DSH_MEME_VERSION } from "./dsh-meme-install.js";
import type { CordisDesktopBridge } from "./cordis-extension-contract.js";

const manifests = [
  { id: "dsh-pet", name: "DSH Pet", version: DSH_PET_VERSION, source: "https://github.com/PC2005-cloud/dsh-pet",
    integrity: `sha512-${DSH_PET_INTEGRITY}`,
    adapter: "standalone", compatibility: "dedicated-adapter", apiVersion: 1,
    capabilities: ["task-state", "settings-window", "sync-tasks", "data-folder"] },
  { id: "dsh-meme", name: "DSH Meme", version: DSH_MEME_VERSION, source: `https://www.npmjs.com/package/dsh-meme/v/${DSH_MEME_VERSION}`,
    integrity: `sha512-${DSH_MEME_INTEGRITY}`,
    adapter: "dedicated-host", compatibility: "dedicated-adapter", apiVersion: 1,
    capabilities: ["model-bridge", "settings-window"] },
] as const;

export type DesktopExtensionId = (typeof manifests)[number]["id"];
export type DesktopExtensionManifest = (typeof manifests)[number];
export type DesktopExtensionPhase = DshPetStatus["phase"];
export interface DesktopExtensionState {
  version: string;
  installed: boolean;
  phase: DesktopExtensionPhase;
  autoStart: boolean;
  syncTasks?: boolean;
  error: string | null;
  progress: DshPetProgress | null;
}
export interface DesktopExtensionEntry { manifest: DesktopExtensionManifest; state: DesktopExtensionState | null }
export interface DesktopExtensionPreferences { autoStart?: boolean; syncTasks?: boolean }
export interface DesktopExtensionsBridge {
  cordis?: CordisDesktopBridge;
  list(): Promise<DesktopExtensionEntry[]>;
  action(id: DesktopExtensionId, action: DshPetAction): Promise<DesktopExtensionState>;
  preferences(id: DesktopExtensionId, value: DesktopExtensionPreferences): Promise<DesktopExtensionState>;
}

interface DesktopExtensionAdapter {
  status: () => DesktopExtensionState;
  action: (action: DshPetAction) => DesktopExtensionState | Promise<DesktopExtensionState>;
  preferences: (value: DesktopExtensionPreferences) => DesktopExtensionState;
  restore: () => void;
  dispose: () => Promise<void>;
}

const actions = new Set(["install", "start", "stop", "uninstall", "cancel", "settings", "folder"]);

export class DesktopExtensionRegistry {
  private readonly adapters = new Map<DesktopExtensionId, DesktopExtensionAdapter>();
  private disposal: Promise<PromiseSettledResult<void>[]> | undefined;

  register(id: DesktopExtensionId, adapter: DesktopExtensionAdapter): void {
    if (this.disposal || !manifests.some(item => item.id === id) || this.adapters.has(id)) throw new Error("Unknown or duplicate desktop extension");
    this.adapters.set(id, adapter);
  }

  list(): DesktopExtensionEntry[] {
    return manifests.map(manifest => ({ manifest, state: this.adapters.get(manifest.id)?.status() ?? null }));
  }

  status(id: DesktopExtensionId): DesktopExtensionState { return this.adapter(id).status(); }

  private adapter(id: unknown): DesktopExtensionAdapter {
    if (this.disposal) throw new Error("Desktop extensions are shutting down");
    const adapter = typeof id === "string" ? this.adapters.get(id as DesktopExtensionId) : undefined;
    if (!adapter) throw new Error("Desktop extension is unavailable");
    return adapter;
  }

  action(id: unknown, action: unknown): ReturnType<DesktopExtensionAdapter["action"]> {
    const adapter = this.adapter(id);
    if (typeof action !== "string" || !actions.has(action) || id !== "dsh-pet" && action === "folder") throw new Error("Unsupported desktop extension action");
    return adapter.action(action as DshPetAction);
  }

  preferences(id: unknown, value: unknown): DesktopExtensionState {
    const adapter = this.adapter(id);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid desktop extension preferences");
    const entries = Object.entries(value);
    if (entries.some(([key, setting]) => typeof setting !== "boolean" || key !== "autoStart" && !(id === "dsh-pet" && key === "syncTasks"))) {
      throw new Error("Unsupported desktop extension preferences");
    }
    if (!entries.length) return adapter.status();
    return adapter.preferences(Object.fromEntries(entries));
  }

  restore(id: DesktopExtensionId): void { this.adapter(id).restore(); }

  dispose(): Promise<PromiseSettledResult<void>[]> {
    this.disposal ??= Promise.allSettled([...this.adapters].reverse().map(async ([id, adapter]) => {
      await adapter.dispose();
      this.adapters.delete(id);
    })).finally(() => { this.disposal = undefined; });
    return this.disposal;
  }
}
