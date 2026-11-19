export const CORDIS_VERSION = "4.1.0";
export const CORDIS_HOST_API = 1;
export const CORDIS_SERVICES = [
  "pioraTasks", "pioraModels", "pioraNotifications", "pioraWindows",
  "pioraStorage", "pioraResources", "pioraLog", "pioraPanel",
] as const;

export type CordisService = (typeof CORDIS_SERVICES)[number];
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export const isExtensionId = (value: string) => /^[a-z][a-z0-9-]{0,63}$/.test(value);
export const isExtensionVersion = (value: string) => /^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?$/.test(value) && value.length <= 64;
export const isPackageName = (value: string) => /^(?:@[a-z0-9][a-z0-9.-]*\/)?[a-z0-9][a-z0-9.-]*$/.test(value) && value.length <= 160;
export const isRpcName = (value: string) => /^[a-z][a-z0-9_.-]{0,63}$/i.test(value);
export const isAssetPath = (value: string) => value.length <= 240 && value.split("/").every(part =>
  /^[a-z0-9_.@-]+$/i.test(part) && part !== "." && part !== ".." && !part.endsWith(".")
  && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));

export interface CordisPackage {
  name: string;
  version: string;
  license: string;
  source: { kind: "npm"; integrity: string } | {
    kind: "bundled";
    files: ReadonlyArray<{ source: string; path: string; sha256: string }>;
  };
  /** Dependency-only packages have no plugin entry. */
  entry?: string;
  inject?: readonly string[];
  optional?: readonly string[];
  provides?: readonly string[];
  config?: Json;
}

export interface CordisRelease {
  version: string;
  cordis: string;
  hostApi: number;
  bundle: string;
  packages: readonly CordisPackage[];
  services: readonly CordisService[];
  schema: number;
  migrateFrom?: readonly number[];
  migrationPackage?: string;
  panel?: { package: string; asset: string; protocol: number; methods: readonly string[] };
  health: { method: string; package: string };
}

export interface CordisProfile {
  id: string;
  name: string;
  source: string;
  description: { en: string; zh: string };
  assetsLicense: string | null;
  /** Latest verified release first. */
  releases: readonly CordisRelease[];
}

export type CordisPhase = "absent" | "stopped" | "starting" | "running" | "stopping" | "installing" | "updating" | "error";
export type CordisAction = "install" | "update" | "start" | "stop" | "cancel" | "uninstall" | "panel";
export type CordisOperation = { outcome: "installed" | "updated" | "failed" | "rolled-back" | "cancelled" | "interrupted"; detail?: string };
export interface CordisEntry {
  id: string;
  name: string;
  source: string;
  description: CordisProfile["description"];
  assetsLicense: string | null;
  releases: Array<{ version: string; packages: Array<{ name: string; version: string; license: string; source: string; integrity: string }> }>;
  compatibility: { cordis: string; hostApi: number; bundle: string; services: readonly string[]; panel: boolean; reason: string | null };
  state: {
    phase: CordisPhase;
    version: string | null;
    runningVersion: string | null;
    previousVersion: string | null;
    autoStart: boolean;
    operation: CordisOperation | null;
    error: string | null;
    progress: { stage: "package" | "data" | "health"; received: number; total: number | null } | null;
    logs: string[];
  };
}

export interface CordisDiscoveryEntry {
  name: string;
  package: string | null;
  version: string | null;
  description: CordisProfile["description"];
  source: string | null;
  compatibility: "unverified" | "incompatible" | "dedicated" | "verified";
}

export interface CordisDesktopBridge {
  list(): Promise<CordisEntry[]>;
  action(id: string, action: CordisAction, version?: string): Promise<CordisEntry>;
  autoStart(id: string, enabled: boolean): Promise<CordisEntry>;
  discover(): Promise<CordisDiscoveryEntry[]>;
}

export function makeJson(value: unknown, limit = 64 * 1024): Json {
  const encoded = JSON.stringify(value === undefined ? null : value);
  if (typeof encoded !== "string" || Buffer.byteLength(encoded) > limit) throw new Error("Extension payload exceeds its JSON limit");
  return JSON.parse(encoded) as Json;
}

export function cordisCompatibility(profile: CordisProfile, release: CordisRelease): string | null {
  if (!isExtensionId(profile.id) || !isExtensionVersion(release.version)) return "Invalid profile or version";
  if (release.cordis !== CORDIS_VERSION || release.hostApi !== CORDIS_HOST_API) return "This Cordis or Piora host API version is unsupported";
  if (release.bundle !== "simple-insert") return "Only simple bundle insertion is supported. Carrier, cross-bundle patches and cross-profile injection require DSH.";
  if (!Number.isSafeInteger(release.schema) || release.schema < 1) return "Unknown data schema";
  if (release.services.some(service => !CORDIS_SERVICES.includes(service))) return "Profile requires an unavailable Piora service";
  const names = new Set<string>();
  const services = new Set<string>(["logger", ...release.services]);
  for (const pkg of release.packages) {
    if (!isPackageName(pkg.name) || names.has(pkg.name) || !isExtensionVersion(pkg.version) || !pkg.license) return "Invalid or duplicate package";
    names.add(pkg.name);
    if (pkg.entry && !isAssetPath(pkg.entry)) return "Invalid plugin entry";
    if (pkg.source.kind === "npm" && !/^sha512-[A-Za-z0-9+/]{86}==$/.test(pkg.source.integrity)) return "Missing npm integrity pin";
    if (pkg.source.kind === "bundled" && pkg.source.files.some(file =>
      !isAssetPath(file.source) || !isAssetPath(file.path) || !/^[0-9a-f]{64}$/.test(file.sha256))) return "Invalid bundled resource";
    for (const service of pkg.provides ?? []) {
      if (!pkg.entry || !isRpcName(service) || services.has(service)) return "Invalid or duplicate service provision";
      services.add(service);
    }
  }
  for (const pkg of release.packages) {
    const missing = pkg.inject?.find(service => !services.has(service));
    if (missing) return "Missing required service: " + missing;
  }
  const hasEntry = (name: string) => release.packages.some(pkg => pkg.name === name && pkg.entry);
  if (!release.services.includes("pioraPanel") || !hasEntry(release.health.package) || !isRpcName(release.health.method)) return "Missing health probe";
  if (release.migrateFrom?.length && (!release.migrationPackage || !hasEntry(release.migrationPackage))) return "Missing data migration entry";
  const panel = release.panel;
  if (panel && (panel.protocol !== 1 || !release.services.includes("pioraPanel") || !hasEntry(panel.package)
    || !isAssetPath(panel.asset) || panel.methods.some(method => !isRpcName(method)))) return "Unsupported client panel entry or RPC protocol";
  return null;
}
