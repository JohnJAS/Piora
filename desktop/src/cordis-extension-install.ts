import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { x } from "tar";
import { download } from "./dsh-pet-install.js";
import { petDispatcher, preparePetNetwork, type PetNetwork } from "./dsh-pet-network.js";
import { isAssetPath, type CordisEntry, type CordisPackage, type CordisRelease } from "./cordis-extension-contract.js";
import { injectionNames, type CommunityManifest } from "./cordis-community-registry.js";

export const extensionPackageDir = (slot: string, name: string) => join(slot, "node_modules", name);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export async function verifyCordisFiles(slot: string, release: CordisRelease): Promise<void> {
  for (const pkg of release.packages) {
    const root = extensionPackageDir(slot, pkg.name);
    const entry = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { name?: unknown; version?: unknown };
    if (entry.name !== pkg.name || entry.version !== pkg.version) throw new Error("Unexpected installed package: " + pkg.name);
    if (pkg.entry && !(await lstat(join(root, pkg.entry))).isFile()) throw new Error("Missing Cordis entry: " + pkg.name);
    if (pkg.source.kind === "bundled") for (const file of pkg.source.files) {
      const actual = sha256(await readFile(join(root, file.path)));
      if (actual !== file.sha256) throw new Error("Bundled package integrity check failed: " + pkg.name);
    }
  }
  if (release.panel && !(await lstat(join(extensionPackageDir(slot, release.panel.package), release.panel.asset))).isFile()) {
    throw new Error("The verified client panel is missing");
  }
  if (release.communityClient) await readCommunityClient(slot, release.communityClient);
}

export async function readCommunityClient(slot: string, client: NonNullable<CordisRelease["communityClient"]>): Promise<Buffer> {
  const file = join(extensionPackageDir(slot, client.package), client.asset);
  const stats = await lstat(file);
  if (!stats.isFile() || stats.size > 512 * 1024) throw new Error("Missing or oversized reviewed community client");
  const bytes = await readFile(file);
  if (sha256(bytes) !== client.sha256) throw new Error("Community client integrity check failed: " + client.package);
  return bytes;
}

async function unpackPinnedArchive(archive: string, root: string) {
  let size = 0;
  let count = 0;
  await x({
    file: archive, cwd: root, strip: 1, strict: true,
    filter(path, entry) {
      const relative = path.replace(/\/$/, "").slice("package/".length);
      if ("type" in entry && path === "package/" && entry.type === "Directory") return false;
      if (!path.startsWith("package/") || !isAssetPath(relative) || !("type" in entry)
          || (entry.type !== "File" && entry.type !== "Directory")) throw new Error("Unsupported archive entry");
      count++;
      size += entry.size;
      if (count > 5000 || size > 64 * 1024 * 1024) throw new Error("The unpacked extension exceeded its size limit");
      return true;
    },
  });
}

async function copyBundledPackage(pkg: CordisPackage, root: string, assets: string, signal: AbortSignal) {
  if (pkg.source.kind !== "bundled") throw new Error("Expected a bundled package");
  for (const file of pkg.source.files) {
    signal.throwIfAborted();
    const bytes = Buffer.from((await readFile(join(assets, file.source), "utf8")).replaceAll("\r\n", "\n"));
    if (sha256(bytes) !== file.sha256) throw new Error("Bundled resource integrity check failed: " + file.source);
    const destination = join(root, file.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: "wx" });
  }
  await writeFile(join(root, "package.json"), JSON.stringify({ name: pkg.name, version: pkg.version, license: pkg.license }), { flag: "wx" });
}

export async function stageCordisPackages(options: {
  slot: string;
  assets: string;
  networkRoot: string;
  network: () => PetNetwork;
  release: CordisRelease;
  signal: AbortSignal;
  progress: (progress: CordisEntry["state"]["progress"]) => void;
}) {
  const { slot, assets, release, signal, progress } = options;
  await mkdir(slot, { recursive: false });
  const network = release.packages.some(pkg => pkg.source.kind === "npm")
    ? await preparePetNetwork(options.networkRoot, options.network()) : undefined;
  const dispatcher = network && petDispatcher(network);
  try {
    await mkdir(join(slot, "node_modules"));
    for (const pkg of release.packages) {
      signal.throwIfAborted();
      const directory = extensionPackageDir(slot, pkg.name);
      await mkdir(directory, { recursive: true });
      if (pkg.source.kind === "bundled") {
        await copyBundledPackage(pkg, directory, assets, signal);
        continue;
      }
      const archive = join(slot, "archive.tgz");
      const base = pkg.name.split("/").at(-1);
      const url = new URL(pkg.name + "/-/" + base + "-" + pkg.version + ".tgz", network!.registry);
      await download(url.href, archive, pkg.source.integrity.slice(7), 32 * 1024 * 1024, signal,
        (received, total) => progress({ stage: "package", received, total }), dispatcher);
      signal.throwIfAborted();
      await unpackPinnedArchive(archive, directory);
      await unlink(archive);
      const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as CommunityManifest;
      const client = release.communityClient;
      if (client?.package === pkg.name) {
        const exported = manifest.exports?.["./client"];
        const path = typeof exported === "object" && exported ? (exported as { default?: unknown }).default : exported;
        const inject = injectionNames(manifest.dsh?.client?.inject);
        if (path !== "./" + client.asset || inject.length !== client.inject.length || inject.some(name => !client.inject.includes(name))) {
          throw new Error("The upstream client entry or required services differ from the reviewed release");
        }
      } else if (manifest.dsh?.bundle?.patch || manifest.dsh?.client) {
        throw new Error("The package requires an unsupported DSH bundle patch or client");
      }
      for (const dependency of Object.keys(manifest.dependencies ?? {})) {
        if (!release.packages.some(candidate => candidate.name === dependency)) throw new Error("Missing pinned dependency: " + dependency);
      }
    }
    signal.throwIfAborted();
    await verifyCordisFiles(slot, release);
  } finally { await dispatcher?.destroy(); }
}
