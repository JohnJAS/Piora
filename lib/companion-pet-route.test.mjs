import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";

const jiti = createJiti(import.meta.url, { alias: { "@": path.resolve(".") } });
const collectionRoute = await jiti.import("../app/api/companion-pets/route.ts");
const spriteRoute = await jiti.import("../app/api/companion-pets/[id]/spritesheet/route.ts");

function webpVpxHeader(width, height) {
  const bytes = Buffer.alloc(48);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(40, 4);
  bytes.write("WEBP", 8, "ascii");
  bytes.write("VP8X", 12, "ascii");
  bytes.writeUInt32LE(10, 16);
  bytes.writeUIntLE(width - 1, 24, 3);
  bytes.writeUIntLE(height - 1, 27, 3);
  bytes.write("VP8 ", 30, "ascii");
  bytes.writeUInt32LE(10, 34);
  bytes[41] = 0x9d;
  bytes[42] = 0x01;
  bytes[43] = 0x2a;
  bytes.writeUInt16LE(width, 44);
  bytes.writeUInt16LE(height, 46);
  return bytes;
}

function routeFixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "piora-pet-route-"));
  const runtimeHome = path.join(base, "home");
  const codexHome = path.join(base, "codex");
  const source = path.join(codexHome, "pets", "route-fox");
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(runtimeHome, { recursive: true });
  fs.writeFileSync(path.join(source, "pet.json"), JSON.stringify({
    id: "route-fox",
    displayName: "Route Fox",
    spriteVersionNumber: 2,
    spritesheetPath: "spritesheet.webp",
  }));
  fs.writeFileSync(path.join(source, "spritesheet.webp"), webpVpxHeader(1536, 2288));

  const previousPioraHome = process.env.PIORA_HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.PIORA_HOME = runtimeHome;
  process.env.CODEX_HOME = codexHome;
  t.after(() => {
    if (previousPioraHome === undefined) delete process.env.PIORA_HOME;
    else process.env.PIORA_HOME = previousPioraHome;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    fs.rmSync(base, { recursive: true, force: true });
  });
  return { runtimeHome };
}

function request(pathname, options = {}) {
  return new NextRequest(`http://localhost:30141${pathname}`, {
    method: options.method ?? "GET",
    headers: {
      host: "localhost:30141",
      ...(options.headers ?? {}),
    },
    body: options.body,
  });
}

test("companion pet routes discover, import, list, replace, and serve an installed atlas", async (t) => {
  routeFixture(t);
  const initialResponse = await collectionRoute.GET(request("/api/companion-pets"));
  assert.equal(initialResponse.status, 200);
  const initial = await initialResponse.json();
  assert.equal(initial.sources.length, 1);
  assert.equal(initial.sources[0].id, "route-fox");
  assert.equal(initial.sources[0].sourceKind, "codex-custom");
  assert.equal(initial.sources[0].sourceKey, "codex-custom:route-fox");
  assert.equal(
    initial.sources[0].atlasUrl,
    "/api/companion-pets/route-fox/spritesheet?sourceKind=codex-custom",
  );
  assert.equal(initial.installed.length, 9);
  const defaultPet = initial.installed.find((pet) => pet.id === "pekka-pal.codex-pet");
  assert.equal(defaultPet.sourceKind, "piora-bundled");
  assert.equal(
    defaultPet.atlasUrl,
    "/companion-pets/bundled/pekka-pal.codex-pet/spritesheet.webp",
  );

  const importRequest = (sourceKind) => request("/api/companion-pets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "import", id: "route-fox", ...(sourceKind ? { sourceKind } : {}) }),
  });
  const importedResponse = await collectionRoute.POST(importRequest());
  assert.equal(importedResponse.status, 201);
  const imported = await importedResponse.json();
  assert.equal(imported.replaced, false);
  assert.equal(imported.pet.atlasUrl, "/api/companion-pets/route-fox/spritesheet");
  assert.equal(imported.pet.sourceKind, "piora-installed");
  assert.equal(imported.pet.origin, "codex-custom");
  assert.deepEqual(
    imported.pet.states.find((state) => state.id === "review").frameIndices.slice(0, 6),
    [64, 65, 66, 67, 68, 69],
  );
  assert.deepEqual(
    imported.pet.states.find((state) => state.id === "look-directions-b").frameIndices,
    [80, 81, 82, 83, 84, 85, 86, 87],
  );

  const replacedResponse = await collectionRoute.POST(importRequest("codex-custom"));
  assert.equal(replacedResponse.status, 200);
  assert.equal((await replacedResponse.json()).replaced, true);

  const listedResponse = await collectionRoute.GET(request("/api/companion-pets"));
  const listed = await listedResponse.json();
  assert.equal(listed.sources[0].installed, true);
  assert.equal(listed.installed.length, 10);
  assert.ok(listed.installed.some((pet) => pet.id === "route-fox"));

  const spriteResponse = await spriteRoute.GET(
    request("/api/companion-pets/route-fox/spritesheet"),
    { params: Promise.resolve({ id: "route-fox" }) },
  );
  assert.equal(spriteResponse.status, 200);
  assert.equal(spriteResponse.headers.get("content-type"), "image/webp");
  assert.equal(spriteResponse.headers.get("x-content-type-options"), "nosniff");
  assert.equal(spriteResponse.headers.get("content-security-policy"), "default-src 'none'; sandbox");
  assert.equal(spriteResponse.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(spriteResponse.headers.get("referrer-policy"), "no-referrer");
  assert.equal(spriteResponse.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(
    Buffer.from(await spriteResponse.arrayBuffer()),
    webpVpxHeader(1536, 2288),
  );

  const sourceSpriteResponse = await spriteRoute.GET(
    request("/api/companion-pets/route-fox/spritesheet?sourceKind=codex-custom"),
    { params: Promise.resolve({ id: "route-fox" }) },
  );
  assert.equal(sourceSpriteResponse.status, 200);
  assert.equal(sourceSpriteResponse.headers.get("content-type"), "image/webp");
});

test("companion pet routes enforce same-origin JSON mutations and bounded ids", async (t) => {
  routeFixture(t);
  const crossSite = await collectionRoute.POST(request("/api/companion-pets", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://attacker.invalid",
      "sec-fetch-site": "cross-site",
    },
    body: JSON.stringify({ action: "import", id: "route-fox" }),
  }));
  assert.equal(crossSite.status, 403);

  const wrongType = await collectionRoute.POST(request("/api/companion-pets", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ action: "import", id: "route-fox" }),
  }));
  assert.equal(wrongType.status, 415);

  const traversal = await collectionRoute.POST(request("/api/companion-pets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "import", id: "../escape" }),
  }));
  assert.equal(traversal.status, 400);
  assert.equal((await traversal.json()).code, "INVALID_PET_ID");

  for (const invalidId of ["NUL", "pet.", "a".repeat(65)]) {
    const invalid = await collectionRoute.POST(request("/api/companion-pets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "import", id: invalidId }),
    }));
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, "INVALID_PET_ID");
  }

  const invalidSource = await collectionRoute.POST(request("/api/companion-pets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "import", id: "route-fox", sourceKind: "remote-url" }),
  }));
  assert.equal(invalidSource.status, 400);
  assert.equal((await invalidSource.json()).code, "INVALID_PET_SOURCE");

  const sourceOnlySprite = await spriteRoute.GET(
    request("/api/companion-pets/route-fox/spritesheet"),
    { params: Promise.resolve({ id: "route-fox" }) },
  );
  assert.equal(sourceOnlySprite.status, 404);

  const invalidSpriteSource = await spriteRoute.GET(
    request("/api/companion-pets/route-fox/spritesheet?sourceKind=remote-url"),
    { params: Promise.resolve({ id: "route-fox" }) },
  );
  assert.equal(invalidSpriteSource.status, 400);
  assert.equal((await invalidSpriteSource.json()).code, "INVALID_PET_SOURCE");

  const invalidAssetId = await spriteRoute.GET(
    request("/api/companion-pets/escape/spritesheet"),
    { params: Promise.resolve({ id: "../escape" }) },
  );
  assert.equal(invalidAssetId.status, 400);
});

test("companion pet routes do not disclose unexpected runtime errors", async () => {
  const saved = {
    PIORA_HOME: process.env.PIORA_HOME,
    USERPROFILE: process.env.USERPROFILE,
    HOME: process.env.HOME,
  };
  delete process.env.PIORA_HOME;
  delete process.env.USERPROFILE;
  delete process.env.HOME;
  try {
    const collectionResponse = await collectionRoute.GET(request("/api/companion-pets"));
    assert.equal(collectionResponse.status, 500);
    assert.deepEqual(await collectionResponse.json(), {
      error: "Companion pet request failed",
    });

    const spriteResponse = await spriteRoute.GET(
      request("/api/companion-pets/safe-pet/spritesheet"),
      { params: Promise.resolve({ id: "safe-pet" }) },
    );
    assert.equal(spriteResponse.status, 500);
    assert.deepEqual(await spriteResponse.json(), {
      error: "Companion pet spritesheet could not be loaded",
    });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
