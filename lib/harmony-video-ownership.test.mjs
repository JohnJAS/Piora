import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { uptime } from "node:os";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createJiti } from "jiti";
const { VideoOwnership, parseVideoDaemonProcesses } = await createJiti(import.meta.url).import("./harmony/runtime/video-ownership.ts");
const previousName = `piora_video_${"a".repeat(32)}.so`, nextName = `piora_video_${"b".repeat(32)}.so`;
const deadPid = Number(spawnSync(process.execPath, ["-e", "console.log(process.pid)"], { encoding: "utf8" }).stdout.trim());
assert.ok(deadPid > 0);

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "piora-video-ownership-test-"));
  const records = join(directory, "records"); await mkdir(records);
  const record = { version: 1, serial: "phone", hostPid: deadPid, name: previousName, port: 45678, ...options.record };
  await writeFile(join(records, `${previousName}.json`), JSON.stringify(record));
  const calls = []; let killed = false;
  const run = async (args, operation) => {
    calls.push({ args, operation }); let text = "";
    if (operation === "debug_video_recovery_owner" && options.daemon !== false) text = `shell 1234 1 0 ? ? uitest start-daemon singleness --extension-name ${previousName}`;
    if (operation === "debug_video_recovery_stop") killed = true;
    if (operation === "debug_video_recovery_socket" && options.foreign) text = "@scrcpy_grpc_socket";
    if (operation === "debug_video_recovery_forwards") text = options.forwards ?? "phone tcp:45678 localabstract:scrcpy_grpc_socket [Forward]";
    return { stdout: Buffer.from(text), stderr: Buffer.alloc(0), exitCode: 0, durationMs: 0 };
  };
  const ownership = new VideoOwnership("phone", nextName, 45679, run, directory);
  t.after(async () => { ownership.release(); await rm(directory, { recursive: true, force: true }); });
  return { directory, records, ownership, calls, get killed() { return killed; }, run };
}

test("positively dead host recovery kills only its random-name daemon and removes matching forward", async t => {
  const f = await fixture(t); await f.ownership.prepare();
  assert.equal(f.killed, true);
  assert.deepEqual(f.calls.filter(c => c.operation === "debug_video_recovery_stop").map(c => c.args[3]), ["kill -9 1234"]);
  assert.deepEqual(f.calls.filter(c => c.operation === "debug_video_recovery_forward_cleanup").map(c => c.args), [["-t", "phone", "fport", "rm", "tcp:45678", "localabstract:scrcpy_grpc_socket"]]);
  assert.deepEqual(await readdir(f.records), [`${nextName}.json`]);
  f.ownership.clear(); f.ownership.release();
  assert.deepEqual(await readdir(f.records), []);
});

test("viewing ownership serializes instances but does not lock another device", async t => {
  const f = await fixture(t);
  assert.throws(() => new VideoOwnership("phone", nextName, 45679, f.run, f.directory), e => e.code === "DEVICE_BUSY");
  const other = new VideoOwnership("other", nextName, 45679, f.run, f.directory); other.release();
  f.ownership.release(); const replacement = new VideoOwnership("phone", nextName, 45679, f.run, f.directory); replacement.release();
});

test("a foreign socket is never stopped and its forward is never removed", async t => {
  const f = await fixture(t, { daemon: false, foreign: true });
  await assert.rejects(f.ownership.prepare(), e => e.code === "DEVICE_BUSY");
  assert.equal(f.killed, false);
  assert.equal(f.calls.some(c => /cleanup/.test(c.operation)), false);
  assert.deepEqual(await readdir(f.records), [`${previousName}.json`], "keep the interrupted record for a later safe recovery");
});

test("shared-session crash recovery removes only its own forward while the foreign service remains active", async t => {
  const f = await fixture(t, { foreign: true, record: { shared: true } });
  await f.ownership.prepare();
  assert.equal(f.killed, false);
  assert.equal(f.calls.some(c => c.operation === "debug_video_recovery_owner" || c.operation === "debug_video_recovery_file_cleanup"), false);
  assert.equal(f.calls.filter(c => c.operation === "debug_video_recovery_forward_cleanup").length, 1);
  assert.deepEqual(await readdir(f.records), [`${nextName}.json`]);
});

test("reused ports, reverse forwards, other devices and remote endpoints survive recovery", async t => {
  const f = await fixture(t, { daemon: false, forwards: "other tcp:45678 localabstract:scrcpy_grpc_socket [Forward]\nphone tcp:45678 tcp:53535 [Forward]\nphone tcp:45678 localabstract:scrcpy_grpc_socket [Reverse]" });
  await f.ownership.prepare();
  assert.equal(f.calls.some(c => c.operation === "debug_video_recovery_forward_cleanup"), false);
});

test("invalid ownership records cannot inject shell commands or select a foreign process", async t => {
  const f = await fixture(t, { record: { name: previousName + "; kill -9 22" } });
  await f.ownership.prepare(); assert.equal(f.calls.length, 0);
});

test("live foreign host PID is preserved, never inferred stale from age", async t => {
  // The test parent's PID is live and different from the current test process.
  const f = await fixture(t, { record: { hostPid: process.ppid } });
  await f.ownership.prepare(); assert.equal(f.calls.length, 0);
  assert.equal((await readdir(f.records)).length, 2);
});

test("multi-record recovery kills later daemon before checking socket release and cleans all stale records", async t => {
  const f = await fixture(t);
  const laterName = `piora_video_${"c".repeat(32)}.so`;
  await writeFile(join(f.records, `${laterName}.json`), JSON.stringify({
    version: 1, serial: "phone", hostPid: deadPid, name: laterName, port: 45680,
  }));
  let daemonAlive = true;
  const calls = [];
  const run = async (args, operation) => {
    calls.push({ args, operation });
    if (operation === "debug_video_recovery_owner") {
      return { stdout: Buffer.from(`shell 2345 1 0 ? ? /system/bin/uitest start-daemon singleness --extension-name ${laterName}`), stderr: Buffer.alloc(0), exitCode: 0, durationMs: 0 };
    }
    if (operation === "debug_video_recovery_stop" && args[3] === "kill -9 2345") daemonAlive = false;
    if (operation === "debug_video_recovery_socket") {
      return { stdout: Buffer.from(daemonAlive ? "@scrcpy_grpc_socket" : ""), stderr: Buffer.alloc(0), exitCode: 0, durationMs: 0 };
    }
    if (operation === "debug_video_recovery_forwards") {
      return {
        stdout: Buffer.from(`phone tcp:45678 localabstract:scrcpy_grpc_socket [Forward]\nphone tcp:45680 localabstract:scrcpy_grpc_socket [Forward]`),
        stderr: Buffer.alloc(0), exitCode: 0, durationMs: 0,
      };
    }
    return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 0, durationMs: 0 };
  };
  f.ownership.release();
  const ownership = new VideoOwnership("phone", nextName, 45679, run, f.directory);
  try {
    await ownership.prepare();
    assert.deepEqual(calls.filter(c => c.operation === "debug_video_recovery_stop").map(c => c.args[3]), ["kill -9 2345"]);
    assert.deepEqual(calls.filter(c => c.operation === "debug_video_recovery_forward_cleanup").map(c => c.args[4]).sort(), ["tcp:45678", "tcp:45680"]);
    assert.deepEqual(await readdir(f.records), [`${nextName}.json`]);
  } finally {
    ownership.release();
  }
});

test("process matcher handles /system/bin/uitest and transient sh wrapper", () => {
  const name = `piora_video_${"d".repeat(32)}.so`;
  const ps = [
    `shell 1001 999 0 ? ? /system/bin/sh -c uitest start-daemon singleness --extension-name ${name} -scale 1`,
    `shell 1002 1 0 ? ? /system/bin/uitest start-daemon singleness --extension-name ${name} -scale 1`,
    `shell 1003 1 0 ? ? uitest start-daemon singleness --extension-name foreign.so`,
  ].join("\n");
  assert.deepEqual(parseVideoDaemonProcesses(ps, name), [
    { pid: 1001, name, isShellWrapper: true },
    { pid: 1002, name, isShellWrapper: false },
  ]);
});

test("reclaimOrphanedDaemons reclaims cross-serial Piora daemon and cleans its stale record and forward", async t => {
  const f = await fixture(t, { record: { serial: "192.168.1.10:40001" } });
  let daemonAlive = true;
  const calls = [];
  const run = async (args, operation) => {
    calls.push({ args, operation });
    if (operation === "debug_video_recovery_owner") {
      return { stdout: Buffer.from(`shell 7777 1 0 ? ? uitest start-daemon singleness --extension-name ${previousName}`), stderr: Buffer.alloc(0), exitCode: 0, durationMs: 0 };
    }
    if (operation === "debug_video_recovery_stop") daemonAlive = false;
    if (operation === "debug_video_recovery_socket") {
      return { stdout: Buffer.from(daemonAlive ? "@scrcpy_grpc_socket" : ""), stderr: Buffer.alloc(0), exitCode: 0, durationMs: 0 };
    }
    if (operation === "debug_video_recovery_forwards") {
      const serial = args[1];
      return { stdout: Buffer.from(`${serial} tcp:45678 localabstract:scrcpy_grpc_socket [Forward]`), stderr: Buffer.alloc(0), exitCode: 0, durationMs: 0 };
    }
    return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 0, durationMs: 0 };
  };
  f.ownership.release();
  const ownership = new VideoOwnership("usb-serial-1", nextName, 45679, run, f.directory);
  try {
    await ownership.prepare();
    assert.equal(await ownership.reclaimOrphanedDaemons(), true);
    assert.deepEqual(calls.filter(c => c.operation === "debug_video_recovery_stop").map(c => c.args[3]), ["kill -9 7777"]);
    assert.equal(calls.some(c => c.operation === "debug_video_recovery_file_cleanup"), true);
    assert.equal(calls.some(c => c.operation === "debug_video_recovery_forward_cleanup"), true);
    assert.deepEqual(await readdir(f.records), [`${nextName}.json`]);
  } finally {
    ownership.release();
  }
});

test("reclaimOrphanedDaemons reclaims unrecorded orphaned Piora daemon", async t => {
  const directory = await mkdtemp(join(tmpdir(), "piora-video-orphan-test-"));
  const orphanName = `piora_video_${"e".repeat(32)}.so`;
  let daemonAlive = true;
  const calls = [];
  const run = async (args, operation) => {
    calls.push({ args, operation });
    if (operation === "debug_video_recovery_owner") {
      return { stdout: Buffer.from(`shell 8888 1 0 ? ? uitest start-daemon singleness --extension-name ${orphanName}`), stderr: Buffer.alloc(0), exitCode: 0, durationMs: 0 };
    }
    if (operation === "debug_video_recovery_stop") daemonAlive = false;
    if (operation === "debug_video_recovery_socket") {
      return { stdout: Buffer.from(daemonAlive ? "@scrcpy_grpc_socket" : ""), stderr: Buffer.alloc(0), exitCode: 0, durationMs: 0 };
    }
    return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 0, durationMs: 0 };
  };
  const ownership = new VideoOwnership("usb-serial-2", nextName, 45679, run, directory);
  t.after(async () => { ownership.release(); await rm(directory, { recursive: true, force: true }); });
  await ownership.prepare();
  assert.equal(await ownership.reclaimOrphanedDaemons(), true);
  assert.deepEqual(calls.filter(c => c.operation === "debug_video_recovery_stop").map(c => c.args[3]), ["kill -9 8888"]);
  assert.equal(calls.some(c => c.operation === "debug_video_recovery_file_cleanup" && c.args[3].includes(orphanName)), true);
});

test("reclaimOrphanedDaemons refuses DEVICE_BUSY when owned by another live host or active in-process session", async t => {
  const f = await fixture(t, { record: { serial: "wifi-serial", hostPid: process.ppid } });
  const calls = [];
  const run = async (args, operation) => {
    calls.push({ args, operation });
    if (operation === "debug_video_recovery_owner") {
      return { stdout: Buffer.from(`shell 9991 1 0 ? ? uitest start-daemon singleness --extension-name ${previousName}`), stderr: Buffer.alloc(0), exitCode: 0, durationMs: 0 };
    }
    return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 0, durationMs: 0 };
  };
  f.ownership.release();
  const ownership = new VideoOwnership("usb-serial", nextName, 45679, run, f.directory);
  try {
    await assert.rejects(ownership.reclaimOrphanedDaemons(), error => error.code === "DEVICE_BUSY" && error.details?.reason === "debug-video-busy");
    assert.equal(calls.some(c => c.operation === "debug_video_recovery_stop"), false);
  } finally {
    ownership.release();
  }

  const liveSibling = new VideoOwnership("wifi-serial-live", `piora_video_${"f".repeat(32)}.so`, 45681, run, f.directory);
  const runActive = async (args, operation) => {
    if (operation === "debug_video_recovery_owner") {
      return { stdout: Buffer.from(`shell 9992 1 0 ? ? uitest start-daemon singleness --extension-name piora_video_${"f".repeat(32)}.so`), stderr: Buffer.alloc(0), exitCode: 0, durationMs: 0 };
    }
    return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 0, durationMs: 0 };
  };
  const checker = new VideoOwnership("usb-serial-live", `piora_video_${"1".repeat(32)}.so`, 45682, runActive, f.directory);
  try {
    await assert.rejects(checker.reclaimOrphanedDaemons(), error => error.code === "DEVICE_BUSY");
  } finally {
    checker.release();
    liveSibling.release();
  }
});

test("reclaimOrphanedDaemons returns false without killing when foreign tool owns socket", async t => {
  const f = await fixture(t);
  const calls = [];
  const run = async (args, operation) => {
    calls.push({ args, operation });
    if (operation === "debug_video_recovery_owner") {
      return { stdout: Buffer.from("shell 3333 1 0 ? ? uitest start-daemon singleness --extension-name libscrcpy_server.so"), stderr: Buffer.alloc(0), exitCode: 0, durationMs: 0 };
    }
    return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 0, durationMs: 0 };
  };
  f.ownership.release();
  const ownership = new VideoOwnership("phone", nextName, 45679, run, f.directory);
  try {
    assert.equal(await ownership.reclaimOrphanedDaemons(), false);
    assert.equal(calls.some(c => c.operation === "debug_video_recovery_stop"), false);
  } finally {
    ownership.release();
  }
});

test("post-reboot record predating OS boot is reclaimed even when hostPid matches a live PID", async t => {
  const preBootMs = Date.now() - uptime() * 1000 - 120_000;
  const f = await fixture(t, { record: { hostPid: process.ppid, createdAt: preBootMs } });
  await f.ownership.prepare();
  assert.equal(f.killed, true);
  assert.deepEqual(await readdir(f.records), [`${nextName}.json`]);
});
