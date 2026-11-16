import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { extractFile, statFile } from "@electron/asar";
import { WebSocket, WebSocketServer } from "ws";
import { createWebRuntimeArchive } from "../scripts/archive-web-runtime.mjs";

test("runtime archive preserves native sidecars and ordinary files after the glob upgrade", async () => {
  const root = await mkdtemp(join(tmpdir(), "piora-dependency-archive-"));
  const source = join(root, "source"), archive = join(root, "runtime.asar");
  const sidecars = [
    "node_modules/node-pty/lib/worker.js", "node_modules/@img/sharp-win32-x64/lib/sharp.node",
    "node_modules/@sqlite.org/sqlite-wasm/sqlite3.wasm", "lib/shell/runtime/worker.cjs",
    "node_modules/hypium-driver/index.js", "lib/harmony/audio/helper.ps1",
    "lib/harmony/runtime/worker.cjs", "lib/harmony/log-library/vendor/log-worker.mjs",
    "node_modules/7z-bin/bin/win/x64/7z.dll", "node_modules/yauzl/index.js",
    "node_modules/pend/index.js", "third_party/harmony-video/lib.dll",
    ".harmony-worker/worker.js",
  ];
  const bundled = ["public/模型 图标.svg", "node_modules/ordinary/index.js", ".config.json"];
  try {
    for (const file of [...sidecars, ...bundled]) {
      await mkdir(dirname(join(source, file)), { recursive: true });
      await writeFile(join(source, file), `fixture:${file}`);
    }
    await createWebRuntimeArchive(source, archive);
    await rm(source, { recursive: true, force: true });
    for (const file of sidecars) {
      const archivePath = join(...file.split("/"));
      assert.equal(statFile(archive, archivePath).unpacked, true, file);
      assert.equal(await readFile(join(`${archive}.unpacked`, file), "utf8"), `fixture:${file}`);
    }
    for (const file of bundled) {
      const archivePath = join(...file.split("/"));
      assert.notEqual(statFile(archive, archivePath).unpacked, true, file);
      assert.equal(extractFile(archive, archivePath).toString(), `fixture:${file}`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ws keeps ordinary ping/pong working and terminates excessive pending automatic pongs", { timeout: 10_000 }, async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0, maxPendingAutoPongs: 2 });
  await once(server, "listening");
  let client;
  try {
    const connection = once(server, "connection");
    client = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
    const [peer] = await connection;
    await once(client, "open");
    const pong = once(client, "pong");
    client.ping("healthy");
    assert.equal((await pong)[0].toString(), "healthy");
    const response = once(client, "message");
    peer.send("still connected");
    assert.equal((await response)[0].toString(), "still connected");

    // Hold socket writes to simulate backpressure deterministically without
    // flooding the OS buffers or depending on platform-specific buffer sizes.
    peer._socket.cork();
    const closed = once(peer, "close");
    for (let index = 0; index < 3; index += 1) client.ping("backpressure");
    assert.equal((await closed)[0], 1006);
  } finally {
    client?.terminate();
    for (const peer of server.clients) peer.terminate();
    await new Promise(resolve => server.close(resolve));
  }
});
