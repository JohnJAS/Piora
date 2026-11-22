export interface BrowserTarget {
  sessionId: string;
  tabId: string;
  navigationEpoch?: number;
}
export interface DeviceViewport {
  enabled: boolean;
  preset: string;
  width: number;
  height: number;
  preview: number;
}
export const initialDevice: DeviceViewport = {
  enabled: false,
  preset: "responsive",
  width: 390,
  height: 844,
  preview: 0,
};
export { devices } from "./device-display.js";
export interface Visit {
  id: number;
  url: string;
  title: string;
  visited: number;
  source: string;
}
export interface BrowserQuery {
  text?: string;
  before?: number;
  since?: number;
  until?: number;
  suggestions?: boolean;
  limit?: number;
}
export type TransferState = "progressing" | "paused" | "interrupted" | "cancelled" | "completed";
export interface Transfer {
  id: number;
  filename: string;
  path: string;
  url: string;
  started: number;
  ended: number | null;
  received: number;
  total: number;
  state: TransferState;
  live: boolean;
  resumable: boolean;
  missing: boolean;
}
export type TransferAction = "pause" | "resume" | "cancel" | "open" | "reveal" | "remove";
export type BrowserSection = "history" | "downloads" | "contacts" | "import" | "privacy" | "devices";
export type MenuChoice =
  | BrowserSection
  | "find"
  | "print"
  | "screenshot"
  | "device"
  | "deviceDefault"
  | "vault"
  | "settings";
export interface ContactFields {
  name: string;
  address: string;
  email: string;
  phone: string;
}
export interface BrowserContact extends ContactFields {
  id: string;
  updated: number;
}
export const clearCategories = ["history", "downloads", "sites", "cache", "contacts", "permissions"] as const;
export type ClearCategory = (typeof clearCategories)[number];
export type ClearRange = "hour" | "day" | "week" | "month" | "all";
export interface ClearOptions {
  categories: ClearCategory[];
  range: ClearRange;
}
export interface ClearPreview {
  token: string;
  counts: Partial<Record<ClearCategory, number>>;
  since: number;
  until: number;
}
export type ImportKind = "passwords" | "cookies";
export interface ImportPreview {
  token: string;
  filename: string;
  kind: ImportKind;
  valid: number;
  duplicates: number;
  skipped: number;
  sites: string[];
}
export interface ImportResult {
  added: number;
  skipped: number;
  failed: number;
}
export type BrowserToolsEvent =
  | { kind: "library"; section: "history" | "downloads" | "contacts" | "devices" }
  | { kind: "shortcut"; target: BrowserTarget; action: "find" | "downloads" | "history" }
  | { kind: "find"; target: BrowserTarget; requestId: number; matches: number; active: number; query: string };
interface Endpoint<I, O> {
  input: I;
  output: O;
}
export interface BrowserEndpoints {
  menu: Endpoint<
    { target: BrowserTarget; x: number; y: number; locale: string; dark: boolean },
    MenuChoice | null
  >;
  dismissMenu: Endpoint<BrowserTarget, void>;
  page: Endpoint<{ target: BrowserTarget; action: "print" | "screenshot" }, void>;
  find: Endpoint<{ target: BrowserTarget; query: string; direction?: "next" | "previous" }, number>;
  history: Endpoint<BrowserQuery, Visit[]>;
  deleteVisit: Endpoint<number, void>;
  downloads: Endpoint<BrowserQuery, Transfer[]>;
  downloadActivity: Endpoint<null, Transfer | null>;
  transfer: Endpoint<{ id: number; action: TransferAction }, void>;
  device: Endpoint<{ target: BrowserTarget; viewport?: DeviceViewport }, DeviceViewport>;
  deviceDefault: Endpoint<boolean | null, boolean>;
  contacts: Endpoint<null, BrowserContact[]>;
  saveContact: Endpoint<ContactFields & { id?: string }, void>;
  deleteContact: Endpoint<string, void>;
  fillContact: Endpoint<{ target: BrowserTarget; id: string }, number>;
  importChoose: Endpoint<ImportKind, ImportPreview | null>;
  importApply: Endpoint<{ token: string; replace: boolean; sites: string[] }, ImportResult>;
  importCancel: Endpoint<string, void>;
  clearPreview: Endpoint<ClearOptions, ClearPreview>;
  clearApply: Endpoint<string, { done: ClearCategory[]; failed: ClearCategory[] }>;
}
export type BrowserToolInvoke = <K extends keyof BrowserEndpoints>(
  command: K,
  input: BrowserEndpoints[K]["input"],
) => Promise<BrowserEndpoints[K]["output"]>;
