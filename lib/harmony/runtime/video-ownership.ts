import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { writePrivateFileAtomicSync } from "../../atomic-file";
import { HarmonyError } from "../errors";
import type { CommandResult } from "../command-runner";
import { acquireDeviceLock, currentHostProcessName, isHostProcessAlive, sharedDeviceLockDirectory } from "./device-lock";
import { readBoundedRegularFile } from "./bounded-file";
import { assertUnredirectedPathSync } from "./path-safety";

type Run = (args: readonly string[], operation: string, signal?: AbortSignal, timeout?: number) => Promise<CommandResult>;
interface Record {
  version: 1;
  serial: string;
  hostPid: number;
  name: string;
  port: number;
  shared?: boolean;
  createdAt?: number;
  hostProcessName?: string;
}
export const VIDEO_EXTENSION_NAME = /^piora_video_[a-f0-9]{32}\.so$/;
export const VIDEO_SOCKET = "localabstract:scrcpy_grpc_socket";
export interface VideoDaemonProcess { pid: number; name: string; isShellWrapper: boolean }
export const videoOwnershipDirectory = () => join(dirname(sharedDeviceLockDirectory()), "video");
const activeVideoNames = new Set<string>();

export function parseVideoDaemonProcesses(psOutput: string, expectedName?: string): VideoDaemonProcess[] {
  const seen = new Set<number>();
  const matches: VideoDaemonProcess[] = [];
  for (const line of psOutput.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 3 || !/^\d+$/.test(fields[1])) continue;
    const pid = Number(fields[1]);
    if (!Number.isSafeInteger(pid) || pid <= 0 || seen.has(pid)) continue;
    const extIndex = fields.indexOf("--extension-name");
    if (extIndex < 0 || extIndex + 1 >= fields.length) continue;
    const name = fields[extIndex + 1];
    if (!VIDEO_EXTENSION_NAME.test(name) || (expectedName && name !== expectedName)) continue;
    const uitestIndex = fields.findIndex(token => token === "uitest" || token.endsWith("/uitest"));
    if (uitestIndex < 0) continue;
    const isShellWrapper = fields.slice(0, uitestIndex).some(token => token === "sh" || token.endsWith("/sh"));
    seen.add(pid);
    matches.push({ pid, name, isShellWrapper });
  }
  return matches;
}

function orderDaemonsForTermination(daemons: readonly VideoDaemonProcess[]): VideoDaemonProcess[] {
  return [...daemons].sort((left, right) => Number(left.isShellWrapper) - Number(right.isShellWrapper));
}

/** A separate viewing lock: passive video never acquires the device's input lease. */
export class VideoOwnership {
  private readonly directory: string;
  private readonly lock: ReturnType<typeof acquireDeviceLock>;
  private readonly record: Record;
  private released = false;

  constructor(serial: string, name: string, port: number, private readonly run: Run, root = videoOwnershipDirectory()) {
    if (!VIDEO_EXTENSION_NAME.test(name) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid video ownership identity");
    this.directory = join(root, "records");
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    assertUnredirectedPathSync(this.directory);
    this.lock = acquireDeviceLock(serial, join(root, "locks"));
    this.record = {
      version: 1,
      serial,
      hostPid: process.pid,
      name,
      port,
      createdAt: Date.now(),
      hostProcessName: currentHostProcessName(),
    };
    activeVideoNames.add(this.record.name);
  }

  private path(record: Record) { return join(this.directory, `${record.name}.json`); }
  private async shell(serial: string, command: string, operation: string) {
    const result = await this.run(["-t", serial, "shell", command], operation, undefined, 8000);
    return result.stdout.toString("utf8").replace(/\0/g, "");
  }

  private unlinkRecord(record: Record): void {
    try { unlinkSync(this.path(record)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }

  private async readRecord(fileName: string): Promise<Record | undefined> {
    if (!fileName.endsWith(".json") || !VIDEO_EXTENSION_NAME.test(fileName.slice(0, -5))) return undefined;
    try {
      const record = JSON.parse((await readBoundedRegularFile(join(this.directory, fileName), 2048)).toString("utf8")) as Record;
      if (
        record.version !== 1
        || typeof record.serial !== "string"
        || !record.serial
        || record.serial.length > 256
        || `${record.name}.json` !== fileName
        || !VIDEO_EXTENSION_NAME.test(record.name)
        || (record.shared !== undefined && typeof record.shared !== "boolean")
        || !Number.isInteger(record.hostPid)
        || record.hostPid < 1
        || !Number.isInteger(record.port)
        || record.port < 1
        || record.port > 65535
        || (record.createdAt !== undefined && (typeof record.createdAt !== "number" || !Number.isFinite(record.createdAt)))
        || (record.hostProcessName !== undefined && typeof record.hostProcessName !== "string")
      ) return undefined;
      return record;
    } catch {
      return undefined;
    }
  }

  private isOwnedByAnotherLiveHost(record: Record): boolean {
    if (activeVideoNames.has(record.name)) return true;
    if (record.hostPid === process.pid) return false;
    return isHostProcessAlive(record.hostPid, {
      ...(typeof record.createdAt === "number" ? { createdAtMs: record.createdAt } : {}),
      ...(typeof record.hostProcessName === "string" && record.hostProcessName ? { hostProcessName: record.hostProcessName } : {}),
    });
  }

  private async pollSocketCleared(serial: string, shouldPoll: boolean): Promise<boolean> {
    let sockets = await this.shell(serial, "cat /proc/net/unix", "debug_video_recovery_socket");
    for (let attempt = 0; shouldPoll && sockets.includes("@scrcpy_grpc_socket") && attempt < 15; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      sockets = await this.shell(serial, "cat /proc/net/unix", "debug_video_recovery_socket");
    }
    return !sockets.includes("@scrcpy_grpc_socket");
  }

  private async cleanForward(serial: string, port: number): Promise<void> {
    const forwards = await this.run(["-t", serial, "fport", "ls"], "debug_video_recovery_forwards", undefined, 8000);
    const ownsForward = forwards.stdout.toString("utf8").split(/\r?\n/).some(line => {
      const fields = line.trim().split(/\s+/);
      return fields.length === 4 && fields[0] === serial && fields[1] === `tcp:${port}` && fields[2] === VIDEO_SOCKET && fields[3] === "[Forward]";
    });
    if (ownsForward) await this.run(["-t", serial, "fport", "rm", `tcp:${port}`, VIDEO_SOCKET], "debug_video_recovery_forward_cleanup", undefined, 8000);
  }

  async prepare(): Promise<void> {
    const recoverable: Record[] = [];
    for (const name of readdirSync(this.directory).filter(entry => entry.endsWith(".json") && VIDEO_EXTENSION_NAME.test(entry.slice(0, -5)))) {
      const record = await this.readRecord(name);
      if (!record || record.serial !== this.record.serial) continue;
      // The viewing lock proves no live session in this process owns this serial.
      if (this.isOwnedByAnotherLiveHost(record)) continue;
      recoverable.push(record);
    }

    const sharedRecords = recoverable.filter(record => record.shared);
    const ownedRecords = recoverable.filter(record => !record.shared);

    for (const record of sharedRecords) {
      await this.cleanForward(record.serial, record.port);
      this.unlinkRecord(record);
    }

    if (ownedRecords.length > 0) {
      // Phase 1: Terminate all recoverable daemons before checking socket release
      // so an earlier record without a live daemon does not trip over a later record's daemon.
      const processes = await this.shell(this.record.serial, "ps -ef", "debug_video_recovery_owner");
      let killedAny = false;
      for (const record of ownedRecords) {
        const matched = orderDaemonsForTermination(parseVideoDaemonProcesses(processes, record.name));
        for (const proc of matched) {
          await this.shell(this.record.serial, `kill -9 ${proc.pid}`, "debug_video_recovery_stop");
          killedAny = true;
        }
      }
      // Phase 2: Wait for @scrcpy_grpc_socket to be released. Never remove
      // forwards or records while a foreign service owns the global socket.
      const cleared = await this.pollSocketCleared(this.record.serial, killedAny);
      if (!cleared) {
        throw new HarmonyError("DEVICE_BUSY", "The debug video channel is still owned by another tool", { details: { reason: "debug-video-busy" } });
      }
      // Phase 3: Clean forwards, device temp files, and local records.
      for (const record of ownedRecords) {
        await this.cleanForward(record.serial, record.port);
        await this.shell(this.record.serial, `rm -f /data/local/tmp/${record.name} /data/local/tmp/${record.name}.log`, "debug_video_recovery_file_cleanup");
        this.unlinkRecord(record);
      }
    }

    // Persist intent before the first upload/start/forward, including startup crashes.
    writePrivateFileAtomicSync(this.path(this.record), JSON.stringify(this.record));
  }

  /**
   * Reclaim orphaned Piora video daemons on the device even if the device's
   * serial changed (e.g. Wi-Fi port change or USB/Wi-Fi switch) or local records
   * were lost. Foreign tools' sockets are never touched.
   */
  async reclaimOrphanedDaemons(): Promise<boolean> {
    const processes = await this.shell(this.record.serial, "ps -ef", "debug_video_recovery_owner");
    const daemons = parseVideoDaemonProcesses(processes).filter(proc => proc.name !== this.record.name);
    if (daemons.length === 0) return false;

    const grouped = new Map<string, { procs: VideoDaemonProcess[]; record?: Record }>();
    for (const proc of daemons) {
      let group = grouped.get(proc.name);
      if (!group) {
        if (activeVideoNames.has(proc.name)) {
          throw new HarmonyError("DEVICE_BUSY", "Another application instance owns this physical device", {
            details: { reason: "debug-video-busy", ownerPid: process.pid },
          });
        }
        const record = await this.readRecord(`${proc.name}.json`);
        if (record && this.isOwnedByAnotherLiveHost(record)) {
          throw new HarmonyError("DEVICE_BUSY", "Another application instance owns this physical device", {
            details: { reason: "debug-video-busy", ownerPid: record.hostPid },
          });
        }
        group = { procs: [], record };
        grouped.set(proc.name, group);
      }
      group.procs.push(proc);
    }

    for (const [name, { procs, record }] of grouped) {
      for (const proc of orderDaemonsForTermination(procs)) {
        await this.shell(this.record.serial, `kill -9 ${proc.pid}`, "debug_video_recovery_stop");
      }
      await this.shell(this.record.serial, `rm -f /data/local/tmp/${name} /data/local/tmp/${name}.log`, "debug_video_recovery_file_cleanup");
      if (record) {
        await this.cleanForward(this.record.serial, record.port).catch(() => undefined);
        if (record.serial !== this.record.serial) {
          await this.cleanForward(record.serial, record.port).catch(() => undefined);
        }
        this.unlinkRecord(record);
      }
    }

    return await this.pollSocketCleared(this.record.serial, true);
  }

  markShared(): void {
    this.record.shared = true;
    writePrivateFileAtomicSync(this.path(this.record), JSON.stringify(this.record));
  }

  clear(): void {
    this.unlinkRecord(this.record);
  }
  release(): void {
    activeVideoNames.delete(this.record.name);
    if (!this.released) { this.lock.release(); this.released = true; }
  }
}
