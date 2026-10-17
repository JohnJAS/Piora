import { constants, createReadStream } from "node:fs";
import { copyFile, lstat, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runCommand } from "../command-runner";
import { HarmonyError } from "../errors";
import { assertUnredirectedPath } from "./path-safety";

// HDC's Windows local-file reader still rejects ordinary MAX_PATH paths, even
// when Node and Java can read them. Leave room for native temporary suffixes.
export const HDC_LOCAL_PATH_LIMIT = 240;
const MAX_LOCAL_BYTES = 2 * 1024 * 1024 * 1024;
const fitsLocalPath = (path: string) => path.length <= HDC_LOCAL_PATH_LIMIT && Buffer.byteLength(path, "utf8") <= HDC_LOCAL_PATH_LIMIT;
const PROTECT_DIRECTORY = [
  "$ErrorActionPreference = 'Stop'",
  "$directory = $env:PIORA_HDC_STAGING_DIRECTORY",
  "$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User",
  "$acl = [System.Security.AccessControl.DirectorySecurity]::new()",
  "$acl.SetOwner($sid)",
  "$acl.SetAccessRuleProtection($true, $false)",
  "$rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')",
  "$acl.AddAccessRule($rule)",
  "[System.IO.Directory]::SetAccessControl($directory, $acl)",
  "$actual = [System.IO.Directory]::GetAccessControl($directory)",
  "$rules = @($actual.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))",
  "if (!$actual.AreAccessRulesProtected -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].IsInherited -or $rules[0].AccessControlType -ne 'Allow' -or $rules[0].FileSystemRights -ne 'FullControl') { throw 'Private directory ACL verification failed' }",
  "[Console]::Out.Write('PIORA_PRIVATE_DIRECTORY_READY')",
].join("\n");

function cancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new HarmonyError("COMMAND_ABORTED", "Device file operation was cancelled");
}
function stagingError(message: string, reason = "local-file-staging-unavailable", sent = false) {
  return new HarmonyError("COMMAND_FAILED", message, { details: { reason, dispatchState: sent ? "sent" : "not-sent" } });
}
async function protectDirectory(directory: string, signal?: AbortSignal) {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
  const result = await runCommand({
    executable: join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"),
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(PROTECT_DIRECTORY, "utf16le").toString("base64")],
    // The command is fixed. The independent environment value is never parsed
    // as PowerShell source, including paths containing quotes or metacharacters.
    env: { ...process.env, PIORA_HDC_STAGING_DIRECTORY: directory },
    timeoutMs: 15_000, maxOutputBytes: 4096, operation: "protect_hdc_local_staging", signal,
  });
  if (result.stdout.toString("utf8").trim() !== "PIORA_PRIVATE_DIRECTORY_READY") throw stagingError("Unable to verify private local transfer permissions");
}

interface LocalPathOptions<T> {
  args: readonly string[];
  execute: (args: readonly string[]) => Promise<T>;
  signal?: AbortSignal;
  platform?: NodeJS.Platform;
  temporaryRoot?: string;
  protect?: typeof protectDirectory;
}
interface Operand { index: number; receive: boolean; install: boolean }
function localOperand(args: readonly string[]): Operand | undefined {
  if (args[0] !== "-t" || !args[1]) return;
  if (args[2] === "install" && (args.length === 4 || (args.length === 5 && args[3] === "-r"))) {
    return { index: args.length - 1, receive: false, install: true };
  }
  if (args[2] !== "file" || !["send", "recv"].includes(args[3])) return;
  if (!(args.length === 6 || (args.length === 8 && args[4] === "-b" && Boolean(args[5])))) return;
  return { index: args[3] === "send" ? args.length - 2 : args.length - 1, receive: args[3] === "recv", install: false };
}
async function fileHash(path: string, signal?: AbortSignal, maximum = MAX_LOCAL_BYTES): Promise<string> {
  cancelled(signal);
  const hash = createHash("sha256");
  let count = 0;
  for await (const chunk of createReadStream(path, { signal, end: maximum })) {
    count += Buffer.byteLength(chunk);
    if (count > maximum) throw stagingError("Local transfer source grew while staging", "local-file-changed");
    hash.update(chunk);
  }
  cancelled(signal);
  return hash.digest("hex");
}
async function regularFile(path: string) {
  await assertUnredirectedPath(path);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_LOCAL_BYTES) throw stagingError("Local transfer source must be a bounded regular file");
  return info;
}
async function removeOwnedFile(path: string, created: Awaited<ReturnType<typeof lstat>>) {
  const current = await lstat(path).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
  if (!current) return;
  if (current.isSymbolicLink() || current.dev !== created.dev || current.ino !== created.ino) throw stagingError("Local transfer cleanup identity changed", "local-file-staging-cleanup-failed", true);
  try { await rm(path, { force: true, maxRetries: 10, retryDelay: 100 }); }
  catch { throw stagingError("Local transfer output could not be removed", "local-file-staging-cleanup-failed", true); }
}
async function copyVerified(source: string, destination: string, signal?: AbortSignal) {
  const before = await regularFile(source);
  const originalHash = await fileHash(source, signal, before.size);
  await assertUnredirectedPath(dirname(destination));
  cancelled(signal);
  await copyFile(source, destination, constants.COPYFILE_EXCL);
  const created = await lstat(destination);
  try {
    cancelled(signal);
    const [after, copied, copiedHash, finalSourceHash] = await Promise.all([
      regularFile(source), regularFile(destination), fileHash(destination, signal, before.size), fileHash(source, signal, before.size),
    ]);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || copied.size !== before.size || copiedHash !== originalHash || finalSourceHash !== originalHash) {
      throw stagingError("Local transfer source changed while staging", "local-file-changed");
    }
    return created;
  } catch (error) {
    await removeOwnedFile(destination, created);
    throw error;
  }
}

/** Adapt only structured local HDC operands; remote paths and -r/-b stay exact. */
export async function withHdcLocalPath<T>(options: LocalPathOptions<T>): Promise<T> {
  const { args, execute, signal } = options;
  const operand = localOperand(args);
  if ((options.platform ?? process.platform) !== "win32" || !operand || fitsLocalPath(args[operand.index])) return await execute(args);
  const original = args[operand.index];
  if (!isAbsolute(original)) throw stagingError("HDC local transfer path must be absolute");
  cancelled(signal);
  const temporaryRoot = resolve(options.temporaryRoot ?? tmpdir());
  await assertUnredirectedPath(temporaryRoot);
  let base = temporaryRoot;
  // Only walk the existing TEMP ancestor chain, at most eight levels, never
  // create at a volume root or change any ancestor's permissions.
  for (let depth = 0; !fitsLocalPath(join(base, ".piora-hdc-XXXXXX", "input.hap")); depth++) {
    const parent = dirname(base);
    if (depth >= 8 || parent === base || parent === parse(parent).root) throw stagingError("No private short local transfer directory is available");
    base = parent;
  }
  await assertUnredirectedPath(base);
  const directory = await mkdtemp(join(base, ".piora-hdc-"));
  const owner = await lstat(directory);
  const staged = join(directory, operand.install ? "input.hap" : "data");
  let sent = false;
  let copiedBack: Awaited<ReturnType<typeof lstat>> | undefined;
  try {
    if (!fitsLocalPath(staged)) throw stagingError("Local transfer staging path is too long");
    await (options.protect ?? protectDirectory)(directory, signal);
    await assertUnredirectedPath(directory);
    cancelled(signal);
    if (!operand.receive) await copyVerified(original, staged, signal);
    else {
      await assertUnredirectedPath(dirname(original));
      const existing = await lstat(original).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
      if (existing) throw stagingError("Local download destination already exists", "local-file-destination-exists");
    }
    cancelled(signal);
    const adapted = [...args];
    adapted[operand.index] = staged;
    sent = true;
    const result = await execute(adapted);
    cancelled(signal);
    if (operand.receive) {
      copiedBack = await copyVerified(staged, original, signal);
      cancelled(signal);
    }
    return result;
  } catch (error) {
    // A receive destination is the caller's not-yet-published temporary file.
    // copyFile(EXCL) never replaces an existing file; remove only our output.
    if (operand.receive && copiedBack) await removeOwnedFile(original, copiedBack);
    if (error instanceof HarmonyError && error.details?.reason === "local-file-staging-cleanup-failed") throw error;
    cancelled(signal);
    if (error instanceof HarmonyError) {
      if (sent && error.details?.dispatchState === "not-sent") throw new HarmonyError(error.code, error.message, { details: { ...error.details, dispatchState: "sent" } });
      throw error;
    }
    throw stagingError("Unable to prepare a private local transfer file", "local-file-staging-unavailable", sent);
  } finally {
    const current = await lstat(directory).catch(() => undefined);
    const within = relative(base, directory);
    if (!current || current.isSymbolicLink() || current.dev !== owner.dev || current.ino !== owner.ino
      || !within || within.startsWith("..") || isAbsolute(within)) throw stagingError("Private local transfer cleanup identity changed", "local-file-staging-cleanup-failed", sent);
    try { await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
    catch { throw stagingError("Private local transfer files could not be removed", "local-file-staging-cleanup-failed", sent); }
  }
}
