import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

type ImageCapableModel = { provider: string; id: string; input?: readonly ("text" | "image")[] };
type CapabilityConfig = { imageInput?: Record<string, true> };

const configPath = (baseDir = getAgentDir()) => join(baseDir, "piora", "model-capabilities.json");
export const modelCapabilityKey = (provider: string, id: string) => `${provider}/${id}`;

function readConfig(baseDir?: string): CapabilityConfig {
  try {
    const parsed = JSON.parse(readFileSync(configPath(baseDir), "utf8")) as CapabilityConfig;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

export function hasConfiguredImageInput(provider: string, id: string, baseDir?: string): boolean {
  return readConfig(baseDir).imageInput?.[modelCapabilityKey(provider, id)] === true;
}

export function modelSupportsImages(model: ImageCapableModel | undefined, baseDir?: string): boolean {
  return !!model && (model.input?.includes("image") === true || hasConfiguredImageInput(model.provider, model.id, baseDir));
}

export function applyConfiguredImageInput<T extends ImageCapableModel>(model: T, baseDir?: string): T {
  if (!modelSupportsImages(model, baseDir) || model.input?.includes("image")) return model;
  return { ...model, input: [...(model.input ?? ["text"]), "image"] } as T;
}

export function writeConfiguredImageInput(provider: string, id: string, enabled: boolean, baseDir?: string): void {
  const config = readConfig(baseDir);
  const imageInput = { ...(config.imageInput ?? {}) };
  const key = modelCapabilityKey(provider, id);
  if (enabled) imageInput[key] = true;
  else delete imageInput[key];
  const path = configPath(baseDir);
  mkdirSync(join(path, ".."), { recursive: true });
  writePrivateFileAtomicSync(path, `${JSON.stringify(Object.keys(imageInput).length ? { imageInput } : {}, null, 2)}\n`);
}
