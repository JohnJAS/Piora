import type { AppUpdater } from "electron-updater";
import type { Logger } from "./logger.js";
import type { DesktopReleaseAudience } from "./release-audience.js";

export interface DesktopReleaseCandidate {
  tag: string;
  version: string;
  channel: "latest" | "beta";
}

interface ParsedVersion {
  raw: string;
  major: number;
  minor: number;
  patch: number;
  beta: number | null;
}

const VERSION_PATTERN = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.(0|[1-9]\d*))?$/;
const RELEASE_TAG_LINK_PATTERN = /\/releases\/tag\/([^"&<\s]+)/gi;
const RELEASES_ATOM_URL = "https://github.com/kexijiang/Piora/releases.atom";
const RELEASE_DOWNLOAD_ROOT = "https://github.com/kexijiang/Piora/releases/download";

function parseVersion(value: string): ParsedVersion | undefined {
  const match = VERSION_PATTERN.exec(value.trim());
  if (!match) return undefined;
  const [, major, minor, patch, beta] = match;
  if (major === undefined || minor === undefined || patch === undefined) return undefined;
  return {
    raw: `${major}.${minor}.${patch}${beta === undefined ? "" : `-beta.${beta}`}`,
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    beta: beta === undefined ? null : Number(beta),
  };
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  if (left.beta === null && right.beta === null) return 0;
  if (left.beta === null) return 1;
  if (right.beta === null) return -1;
  return left.beta - right.beta;
}

export function releaseTagsFromAtom(feedXml: string): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const match of feedXml.matchAll(RELEASE_TAG_LINK_PATTERN)) {
    const encoded = match[1];
    if (!encoded) continue;
    let tag: string;
    try {
      tag = decodeURIComponent(encoded);
    } catch {
      continue;
    }
    if (seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

export function selectDesktopReleaseCandidate(
  tags: readonly string[],
  currentVersion: string,
  audience: DesktopReleaseAudience,
): DesktopReleaseCandidate | null {
  const current = parseVersion(currentVersion);
  if (!current) throw new Error(`Current desktop version is not supported by the updater: ${currentVersion}`);

  let selected: { tag: string; parsed: ParsedVersion } | undefined;
  for (const tag of tags) {
    const parsed = parseVersion(tag);
    if (!parsed || (audience === "stable" && parsed.beta !== null)) continue;
    if (compareVersions(parsed, current) <= 0) continue;
    if (!selected || compareVersions(parsed, selected.parsed) > 0) {
      selected = { tag, parsed };
    }
  }
  if (!selected) return null;
  return {
    tag: selected.tag,
    version: selected.parsed.raw,
    channel: selected.parsed.beta === null ? "latest" : "beta",
  };
}

export async function preparePreviewUpdateFeed(
  updater: AppUpdater,
  currentVersion: string,
  fetchFeed: (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>,
  logger: Logger,
): Promise<boolean> {
  const response = await fetchFeed(RELEASES_ATOM_URL);
  if (!response.ok) throw new Error(`GitHub release feed returned HTTP ${response.status}`);
  const tags = releaseTagsFromAtom(await response.text());
  const candidate = selectDesktopReleaseCandidate(tags, currentVersion, "preview");
  if (!candidate) {
    logger.info("No eligible preview or stable desktop update is available", { currentVersion });
    return false;
  }

  updater.allowPrerelease = true;
  updater.channel = candidate.channel;
  updater.allowDowngrade = false;
  updater.setFeedURL({
    provider: "generic",
    url: `${RELEASE_DOWNLOAD_ROOT}/${encodeURIComponent(candidate.tag)}`,
    channel: candidate.channel,
  });
  logger.info("Selected desktop update candidate", candidate);
  return true;
}
