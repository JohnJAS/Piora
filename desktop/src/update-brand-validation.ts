export interface UpdateBrand {
  id: string;
  artifactPrefix: string;
  updateChannels: { stable: string; preview: string };
}

/** Only a single, relative installer from this brand may be downloaded. */
export function validateBrandUpdateInfo(info: unknown, brand: UpdateBrand, expectedVersion?: string): void {
  if (!info || typeof info !== "object") throw new Error("Invalid branded update metadata");
  const metadata = info as Record<string, unknown>;
  if (typeof metadata.version !== "string" || !/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(metadata.version)
    || (expectedVersion !== undefined && metadata.version !== expectedVersion)) throw new Error("Update metadata version does not match the selected release");
  const filename = `${brand.artifactPrefix}-${metadata.version}-win-x64-setup.exe`;
  if (!Array.isArray(metadata.files) || metadata.files.length !== 1) throw new Error("Brand update must contain exactly one installer");
  const file = metadata.files[0] as Record<string, unknown> | null;
  if (!file || typeof file !== "object" || file.url !== filename || (metadata.path !== undefined && metadata.path !== filename)) {
    throw new Error(`Update metadata must point only to ${filename}; cross-brand and external paths are forbidden`);
  }
  if (typeof file.sha512 !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512)
    || (metadata.sha512 !== undefined && metadata.sha512 !== file.sha512)
    || typeof file.size !== "number" || !Number.isSafeInteger(file.size) || file.size <= 0) {
    throw new Error("Update metadata requires a matching SHA-512 and installer size");
  }
  if (metadata.packages !== undefined) throw new Error("Unexpected web-installer packages in branded update");
  if (typeof metadata.releaseNotes !== "string" || !metadata.releaseNotes.trim()) throw new Error("Update metadata is missing release notes");
}
