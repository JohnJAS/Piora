import { mkdirSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { writePrivateFileAtomicSync } from "../atomic-file.ts";

const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export function getPlanDocumentPath(
  plansDirectory: string,
  sessionId: string,
  runId: string,
  version: number,
): string {
  if (!SAFE_ID_PATTERN.test(sessionId)) throw new Error("Invalid plan session id");
  if (!SAFE_ID_PATTERN.test(runId)) throw new Error("Invalid plan run id");
  if (!Number.isSafeInteger(version) || version < 1 || version > 10_000) {
    throw new Error("Invalid plan version");
  }
  const baseDir = resolve(plansDirectory);
  const target = resolve(baseDir, sessionId, `${runId}-v${version}.md`);
  if (!target.startsWith(`${baseDir}${sep}`)) {
    throw new Error("Plan path escapes plans directory");
  }
  return target;
}

export function writePlanDocument(
  plansDirectory: string,
  sessionId: string,
  runId: string,
  version: number,
  markdown: string,
): string {
  const filePath = getPlanDocumentPath(plansDirectory, sessionId, runId, version);
  mkdirSync(resolve(plansDirectory, sessionId), { recursive: true, mode: 0o700 });
  writePrivateFileAtomicSync(filePath, markdown);
  return filePath;
}

export function readPlanDocument(filePath: string | undefined): string | null {
  if (!filePath || typeof filePath !== "string") return null;
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
