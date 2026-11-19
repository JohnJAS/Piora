import { fetch } from "undici";
import { satisfies } from "semver";
import { CORDIS_SERVICES, CORDIS_VERSION, isPackageName, isRpcName, type CordisCheckReason, type CordisCheckResult } from "./cordis-extension-contract.js";
import { petDispatcher, type PetNetwork } from "./dsh-pet-network.js";

export interface CommunityManifest {
  name?: unknown;
  version?: unknown;
  dist?: { integrity?: unknown };
  dsh?: {
    client?: { inject?: unknown };
    bundle?: { patch?: unknown; carrier?: unknown };
    marketplace?: { manualSteps?: unknown; requiresBuildApproval?: unknown };
  };
  cordis?: { inject?: unknown };
  exports?: Record<string, unknown>;
  engines?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  optionalDependencies?: Record<string, unknown>;
}

export function injectionNames(value: unknown): string[] {
  const valid = (name: unknown): name is string => typeof name === "string" && (isPackageName(name) || isRpcName(name));
  if (Array.isArray(value)) return [...new Set(value.filter(valid))];
  if (value && typeof value === "object") return Object.keys(value).filter(valid);
  return [];
}

export function inspectCommunityManifest(manifest: CommunityManifest): CordisCheckResult {
  const reasons: CordisCheckReason[] = [];
  const report = (code: CordisCheckReason["code"], detail?: string) => {
    reasons.push({ code, ...(detail ? { detail: detail.slice(0, 640) } : {}) });
  };
  const dsh = manifest.dsh;
  const peers = Object.keys(manifest.peerDependencies ?? {}).filter(name => !manifest.peerDependenciesMeta?.[name]?.optional);
  const dependencies = Object.keys(manifest.dependencies ?? {}).filter(name => !Object.hasOwn(manifest.optionalDependencies ?? {}, name));
  const required = new Set([...dependencies, ...peers].filter(isPackageName));
  const client = new Set([...injectionNames(dsh?.client?.inject),
    ...[...required].filter(name => name.startsWith("@deepseek-ai/dsh-client-"))]);
  if (dsh?.client || client.size) report("clientServices", [...client].join(", "));
  const available = new Set<string>(["logger", ...CORDIS_SERVICES]);
  const host = [...injectionNames(manifest.cordis?.inject).filter(name => !available.has(name)),
    ...[...required].filter(name => name.startsWith("@deepseek-ai/dsh-") && !client.has(name))];
  if (host.length || typeof manifest.engines?.dsh === "string") {
    const range = typeof manifest.engines?.dsh === "string" ? "DSH " + manifest.engines.dsh : "";
    report("hostServices", [...new Set(host), range].filter(Boolean).join(", "));
  }
  if (dsh?.bundle?.patch) report("bundlePatch", typeof dsh.bundle.patch === "string" ? dsh.bundle.patch : undefined);
  if (dsh?.bundle?.carrier) report("carrier");
  if (dsh?.marketplace?.manualSteps === true || dsh?.marketplace?.requiresBuildApproval === true) report("manualSteps");
  const cordisRange = manifest.peerDependencies?.["@deepseek-ai/cordis"] ?? manifest.dependencies?.["@deepseek-ai/cordis"];
  if (typeof cordisRange === "string" && !satisfies(CORDIS_VERSION, cordisRange)) {
    report("cordisVersion", cordisRange + " (Piora: " + CORDIS_VERSION + ")");
  }
  const unpinned = [...required].filter(name => name !== "@deepseek-ai/cordis" && !host.includes(name) && !client.has(name));
  if (unpinned.length) report("dependencies", unpinned.join(", "));
  if (typeof manifest.dist?.integrity !== "string" || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(manifest.dist.integrity)) report("missingIntegrity");
  const compatibility = reasons.length ? "incompatible" : "unverified";
  report("needsReview");
  return { compatibility, reasons };
}

export async function checkCommunityPackage(name: string, version: string, network: PetNetwork, signal: AbortSignal): Promise<CordisCheckResult> {
  const dispatcher = petDispatcher(network);
  try {
    const registry = new URL(encodeURIComponent(name) + "/" + encodeURIComponent(version), network.registry);
    const response = await fetch(registry, {
      dispatcher, redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    if (response.status === 404) return { compatibility: "unavailable", reasons: [{ code: "missingRelease" }] };
    if (!response.ok || !response.body) throw new Error("npm registry returned HTTP " + response.status);
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 512 * 1024) throw new Error("npm version metadata exceeded its size limit");
      chunks.push(Buffer.from(chunk));
    }
    const manifest = JSON.parse(Buffer.concat(chunks).toString("utf8")) as CommunityManifest | null;
    if (manifest?.name !== name || manifest.version !== version) throw new Error("npm registry returned a different package or version");
    return inspectCommunityManifest(manifest);
  } finally { await dispatcher.destroy(); }
}
