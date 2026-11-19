import type { CordisRelease, Json } from "./cordis-extension-contract.js";

export interface CordisBoot {
  release: CordisRelease;
  slot: string;
  data: string;
  fromSchema?: number;
}

export type HostAction = { action: "boot"; input: CordisBoot }
  | { action: "invoke"; input: { method: string; payload: Json } }
  | { action: "dispose" };
export type HostRequest = HostAction & { type: "request"; id: number };
export type HostResponse = { type: "result"; id: number; value?: Json; error?: string };
export type HostService = "tasks" | "model" | "notify" | "openPanel" | "closePanel" | "log";
export type HostServiceRequest = { type: "service"; id: number; service: HostService; input: Json };
export type HostCancel = { type: "cancel"; id: number };
