import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";
import { execFileSync } from "node:child_process";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET } = await jiti.import("../app/api/file-index/route.ts");

test("filename recovery refreshes stale listings and returns exact, authorized candidates", async () => {
  const root = await fs.promises.mkdtemp(path.join(tmpdir(), "piora-file-recovery-"));
  const previousRoots = globalThis.__piAllowedRootsCache;
  try {
    execFileSync("git", ["init", "--quiet", root], { windowsHide: true });
    await fs.promises.writeFile(path.join(root, ".gitignore"), "openspec/\n");
    await fs.promises.mkdir(path.join(root, "openspec/change-a"), { recursive: true });
    await fs.promises.mkdir(path.join(root, "openspec/change-b"), { recursive: true });
    await fs.promises.writeFile(path.join(root, "openspec/change-a/proposal.md"), "proposal a");
    await fs.promises.writeFile(path.join(root, "openspec/change-b/proposal-extra.md"), "different filename");
    globalThis.__piAllowedRootsCache = { roots: new Set([root]), expiresAt: Date.now() + 60000 };
    const request = name => new NextRequest(`http://localhost/api/file-index?${new URLSearchParams({ cwd: root, name })}`);
    let response = await GET(request("proposal.md"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { matches: [{ path: "openspec/change-a/proposal.md", isDir: false }], truncated: false });
    await fs.promises.writeFile(path.join(root, "openspec/change-b/proposal.md"), "proposal b");
    response = await GET(request("proposal.md"));
    assert.deepEqual((await response.json()).matches.map(item => item.path).sort(), ["openspec/change-a/proposal.md", "openspec/change-b/proposal.md"], "new files invalidate a formerly unique match");
    assert.equal((await GET(request("../proposal.md"))).status, 400);
    assert.deepEqual((await (await GET(request("not-present.md"))).json()).matches, []);
    globalThis.__piAllowedRootsCache = { roots: new Set(), expiresAt: Date.now() + 60000 };
    assert.equal((await GET(request("proposal.md"))).status, 403, "filename lookup never widens the file allow-list");
  } finally {
    globalThis.__piAllowedRootsCache = previousRoots;
    globalThis.__piFileIndexCache?.delete(root);
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("concurrent cold searches use a versioned worker index that refreshes without bypassing authorization", async () => {
  const root = await fs.promises.mkdtemp(path.join(tmpdir(), "piora-file-index-"));
  const previousRoots = globalThis.__piAllowedRootsCache;
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
    assert.equal(globalThis.__piFileIndexPending?.size, 0);
    const original = globalThis.__piFileIndexCache?.get(root);
    assert.ok(original?.version, "the worker returned a versioned listing");
    await fs.promises.writeFile(path.join(root, "src", "new-feature.ts"), "");
    assert.deepEqual((await (await GET(request("new-feature"))).json()).matches, []);
    original.expiresAt = Date.now() - 1;
    await GET(request(""));
    await Promise.all(globalThis.__piFileIndexPending.values());
    assert.notEqual(globalThis.__piFileIndexCache.get(root).version, original.version);
    assert.deepEqual((await (await GET(request("new-feature"))).json()).matches, [{ path: "src/new-feature.ts", isDir: false }]);
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
