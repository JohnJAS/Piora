import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET } = await jiti.import("../app/api/file-index/route.ts");

test("concurrent cold searches share one async directory walk and cached indexes remain authorized", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(tmpdir(), "piora-file-index-"));
  const previousRoots = globalThis.__piAllowedRootsCache;
  const originalRead = fs.promises.readdir;
  let rootReads = 0;
  t.mock.method(fs.promises, "readdir", async (dir, options) => {
    if (dir === root) rootReads += 1;
    return originalRead(dir, options);
  });
  try {
    await fs.promises.mkdir(path.join(root, "src"));
    await fs.promises.mkdir(path.join(root, "node_modules"));
    await fs.promises.writeFile(path.join(root, "src", "app.ts"), "");
    await fs.promises.writeFile(path.join(root, "node_modules", "ignored.js"), "");
    globalThis.__piAllowedRootsCache = { roots: new Set([root]), expiresAt: Date.now() + 60_000 };
    const request = query => new NextRequest(`http://localhost/api/file-index?cwd=${encodeURIComponent(root)}${query ? `&q=${query}` : ""}`);
    const [a, b] = await Promise.all([GET(request("")), GET(request("app"))]);
    assert.equal(a.status, 200);
    assert.deepEqual((await a.json()).files, ["src/app.ts"]);
    assert.deepEqual((await b.json()).matches, [{ path: "src/app.ts", isDir: false }]);
    assert.equal(rootReads, 1, "both requests await one filesystem scan");
    await GET(request(""));
    assert.equal(rootReads, 1, "warm reads reuse the completed scan");
    globalThis.__piAllowedRootsCache = { roots: new Set(), expiresAt: Date.now() + 60_000 };
    assert.equal((await GET(request(""))).status, 403, "cached paths do not bypass authorization");
  } finally {
    globalThis.__piAllowedRootsCache = previousRoots;
    globalThis.__piFileIndexCache?.delete(root);
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("piora-file-index-"));
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});
