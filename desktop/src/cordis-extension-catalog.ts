import { fetch } from "undici";
import { CORDIS_HOST_API, CORDIS_VERSION, cordisCompatibility, isExtensionVersion, isPackageName, type CordisDiscoveryEntry, type CordisProfile, type CordisRelease } from "./cordis-extension-contract.js";
import { petDispatcher, preparePetNetwork, type PetNetwork } from "./dsh-pet-network.js";
import { communityCordisCatalog } from "./cordis-community-catalog.js";

const monitorRelease = (version: string, schema: number): CordisRelease => ({
  version, schema, cordis: CORDIS_VERSION, hostApi: CORDIS_HOST_API, bundle: "simple-insert",
  ...(schema === 2 ? { migrateFrom: [1], migrationPackage: "piora-task-monitor-service" } : {}),
  services: ["pioraTasks", "pioraStorage", "pioraPanel"],
  packages: [
    {
      name: "piora-task-monitor-service", version, license: "MIT", entry: "index.cjs",
      inject: ["pioraTasks", "pioraStorage"], provides: ["taskMonitor"],
      source: { kind: "bundled", files: [
        { source: "task-monitor/provider.cjs", path: "index.cjs", sha256: "261bac2acffd83f3992c7421a0c898cd8a9781b7ac38c4012f646407a8c52713" },
      ] },
    },
    {
      name: "piora-task-monitor-panel", version, license: "MIT", entry: "index.cjs",
      inject: ["taskMonitor", "pioraPanel"],
      source: { kind: "bundled", files: [
        { source: "task-monitor/panel.cjs", path: "index.cjs", sha256: "69444261c7fac50dc8e93c395c61108fe169884b6754601eb946a84b973487fe" },
        { source: "task-monitor/panel.html", path: "panel.html", sha256: "d0114ffedf271f21ac1645afa2f3b1b5788aa1f8a3d5e852c55ae7cd8b844a31" },
      ] },
    },
  ],
  health: { package: "piora-task-monitor-panel", method: "monitor.health" },
  panel: { package: "piora-task-monitor-panel", asset: "panel.html", protocol: 1, methods: ["monitor.snapshot", "monitor.set-compact"] },
});

export const bundledCordisCatalog: readonly CordisProfile[] = [
  {
    id: "piora-task-monitor", name: "Piora Task Monitor",
    description: { en: "See running tasks and requests awaiting approval in a separate window.", zh: "在独立窗口查看正在运行的任务和等待确认的请求。" },
    source: "https://github.com/kexijiang/pi-desktop/tree/main/desktop/cordis-plugins/task-monitor",
    assetsLicense: "MIT",
    releases: [monitorRelease("1.1.0", 2), monitorRelease("1.0.0", 1)],
  },
  ...communityCordisCatalog,
];

const discoveryUrl = "https://awesome-dsh-plugin.com/plugins.json";
const maxDiscoveryBytes = 32 * 1024 * 1024;

function trustedCatalogLink(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 512) return null;
  try {
    const link = new URL(value);
    if (link.protocol === "https:" && !link.username && !link.password && !link.port
      && (link.hostname === "github.com" || link.hostname === "awesome-dsh-plugin.com")) return link.href;
  } catch { /* Invalid listing links are ignored. */ }
  return null;
}

export function parseCordisDiscovery(value: unknown, catalog: readonly CordisProfile[], dedicated: ReadonlyMap<string, string>): CordisDiscoveryEntry[] {
  const input = value as { plugins?: unknown };
  if (!Array.isArray(input?.plugins)) throw new Error("The DSH directory returned an invalid listing");
  const approved = new Map(catalog.flatMap(profile => profile.releases.flatMap(release =>
    profile.community && !cordisCompatibility(profile, release)
      ? [[profile.community.package + "@" + release.version, profile.id] as const] : [])));
  const output: CordisDiscoveryEntry[] = [];
  for (const raw of input.plugins as Array<Record<string, unknown> | null>) {
    if (!raw || typeof raw.name !== "string" || !raw.name.trim()) continue;
    const pkg = typeof raw.npm === "string" && isPackageName(raw.npm) ? raw.npm : null;
    const version = typeof raw.version === "string" && isExtensionVersion(raw.version) ? raw.version : null;
    const description = raw.description as { en?: unknown; zh?: unknown } | null;
    const text = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 420) : "";
    const verifiedId = pkg && version ? approved.get(pkg + "@" + version) ?? null : null;
    const compatibility = pkg && version && dedicated.get(pkg) === version ? "dedicated" : verifiedId ? "verified" : "unverified";
    output.push({
      name: raw.name.trim().slice(0, 100), package: pkg, version,
      description: { en: text(description?.en), zh: text(description?.zh) },
      source: trustedCatalogLink(raw.page) ?? trustedCatalogLink(raw.url), compatibility, verifiedId,
    });
  }
  return output;
}

export async function discoverCordisExtensions(root: string, network: PetNetwork, catalog: readonly CordisProfile[], dedicated: ReadonlyMap<string, string>, signal: AbortSignal) {
  const dispatcher = petDispatcher(await preparePetNetwork(root, network));
  const idle = new AbortController();
  const idleTimer = setTimeout(() => idle.abort(new Error("The DSH directory download stopped responding")), 45_000);
  const deadline = AbortSignal.any([signal, idle.signal, AbortSignal.timeout(5 * 60_000)]);
  try {
    const response = await fetch(discoveryUrl, { dispatcher, signal: deadline, redirect: "error" });
    if (!response.ok || !response.body) throw new Error("The DSH directory is unavailable (" + response.status + ")");
    idleTimer.refresh();
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      idleTimer.refresh();
      size += chunk.byteLength;
      if (size > maxDiscoveryBytes) throw new Error("The DSH directory exceeded its size limit");
      chunks.push(Buffer.from(chunk));
    }
    return parseCordisDiscovery(JSON.parse(Buffer.concat(chunks).toString("utf8")), catalog, dedicated);
  } finally {
    clearTimeout(idleTimer);
    await dispatcher.destroy();
  }
}
