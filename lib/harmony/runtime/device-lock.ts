import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { uptime } from "node:os";
import { getRuntimeUserHomeDirectory as homedir } from "../../runtime-home";
import { basename, join } from "node:path";
import { HarmonyError } from "../errors";

export const sharedDeviceLockDirectory = () => join(homedir(), ".piora-device-control", "locks");
interface Owner { pid: number; nonce: string; startedAt: string; hostProcessName?: string }

export function currentHostProcessName(): string {
  return basename(process.execPath).toLowerCase().replace(/\.exe$/, "");
}

export function isHostProcessAlive(pid: number, options?: { createdAtMs?: number; hostProcessName?: string }): boolean {
  if (!Number.isInteger(pid) || pid < 1) return true;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
  }
  const hasCreatedAt = typeof options?.createdAtMs === "number" && Number.isFinite(options.createdAtMs);
  const expectedName = options?.hostProcessName?.trim();
  if (hasCreatedAt && Date.now() - uptime() * 1000 > options!.createdAtMs! + 60_000) {
    return false;
  }
  if (!hasCreatedAt && !expectedName) return true;

  if (process.platform === "win32") {
    try {
      const output = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if (-not $p) { 'DEAD' } else { $n = $p.ProcessName; $t = ''; try { $t = ([DateTimeOffset]$p.StartTime).ToUnixTimeMilliseconds() } catch {}; "$n|$t" }`,
        ],
        { encoding: "utf8", timeout: 2000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      if (output === "DEAD") return false;
      const parts = output.split("|");
      if (parts.length === 2) {
        const [procNameRaw, startMsRaw] = parts;
        if (expectedName && procNameRaw && procNameRaw.toLowerCase() !== expectedName.toLowerCase()) {
          return false;
        }
        if (hasCreatedAt && /^\d+$/.test(startMsRaw) && Number(startMsRaw) > options!.createdAtMs! + 5_000) {
          return false;
        }
      }
    } catch {
      return true;
    }
    return true;
  }

  if (process.platform === "linux") {
    try {
      const comm = readFileSync(`/proc/${pid}/comm`, "utf8").trim().toLowerCase();
      if (expectedName && comm !== expectedName.toLowerCase().slice(0, 15)) {
        return false;
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ESRCH") return false;
      return true;
    }
  }
  return true;
}

/** All brands/profiles/processes use the same physical serial namespace. */
export function acquireDeviceLock(serial: string, directory = sharedDeviceLockDirectory()): { release(): void; owner: Owner } {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (lstatSync(directory).isSymbolicLink()) throw new HarmonyError("DEVICE_BUSY", "Device lock directory cannot be a symlink");
  const path = join(directory, createHash("sha256").update(serial).digest("hex"));
  const gate = `${path}.gate`;
  // Serialize acquisition, dead-owner retirement and release. A crashed gate is
  // deliberately not stolen by timeout; explicit recovery must inspect its owner.
  const withGate = <T>(work: () => T): T => {
    try { mkdirSync(gate, { mode: 0o700 }); }
    catch { throw new HarmonyError("DEVICE_BUSY", "Device ownership is changing or needs explicit recovery"); }
    try { return work(); } finally { rmdirSync(gate); }
  };
  const owner: Owner = { pid: process.pid, nonce: randomUUID(), startedAt: new Date().toISOString(), hostProcessName: currentHostProcessName() };
  return withGate(() => {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(path, { mode: 0o700 });
      writeFileSync(join(path, "owner.json"), JSON.stringify(owner), { flag: "wx", mode: 0o600, flush: true });
      let released = false;
      return { owner, release() {
        if (released) return;
        withGate(() => {
        const current = JSON.parse(readFileSync(join(path, "owner.json"), "utf8")) as Owner;
        if (current.nonce !== owner.nonce) throw new HarmonyError("DEVICE_BUSY", "Device ownership changed; refusing foreign cleanup");
        released = true;
        rmSync(path, { recursive: true });
        });
      } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let previous: Owner;
      try { previous = JSON.parse(readFileSync(join(path, "owner.json"), "utf8")) as Owner; }
      catch { throw new HarmonyError("DEVICE_BUSY", "Device ownership is being established or needs explicit recovery"); }
      const createdAtMs = typeof previous.startedAt === "string" ? Date.parse(previous.startedAt) : Number.NaN;
      if (
        !Number.isInteger(previous.pid)
        || previous.pid < 1
        || isHostProcessAlive(previous.pid, {
          ...(Number.isFinite(createdAtMs) ? { createdAtMs } : {}),
          ...(typeof previous.hostProcessName === "string" && previous.hostProcessName ? { hostProcessName: previous.hostProcessName } : {}),
        })
      ) {
        throw new HarmonyError("DEVICE_BUSY", "Another application instance owns this physical device", { details: { ownerPid: previous.pid } });
      }
      // Reclaim only a positively dead owner, never merely an old heartbeat/PID file.
      if (lstatSync(path).isSymbolicLink()) throw new HarmonyError("DEVICE_BUSY", "Invalid device ownership path");
      const current = JSON.parse(readFileSync(join(path, "owner.json"), "utf8")) as Owner;
      if (current.nonce !== previous.nonce) continue;
      const retired = join(directory, `retired-${randomUUID()}`);
      try { renameSync(path, retired); } catch { continue; }
      if (existsSync(retired)) rmSync(retired, { recursive: true });
    }
  }
  throw new HarmonyError("DEVICE_BUSY", "Device ownership changed during acquisition");
  });
}
