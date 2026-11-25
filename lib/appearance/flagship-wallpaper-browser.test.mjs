import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import ts from "typescript";

const repo = path.resolve(import.meta.dirname, "../..");

test("flagship day and night WebGL scenes react distinctly across moods while keeping the left reading area untouched", { timeout: 120000 }, async () => {
  const browser = await chromium.launch({
    ...(process.env.PIORA_BROWSER_EXECUTABLE ? { executablePath: process.env.PIORA_BROWSER_EXECUTABLE }
      : process.platform === "win32" ? { channel: "msedge" } : {}),
    args: ["--enable-unsafe-swiftshader"],
    headless: true,
  });

  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await page.route("http://flagship.test/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.startsWith("/lib/")) {
        const rel = pathname.slice(5).replace(/\.ts$/, "");
        const source = await readFile(path.join(repo, "lib", `${rel}.ts`), "utf8");
        const compiled = ts.transpileModule(source, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        });
        return route.fulfill({ contentType: "text/javascript", body: compiled.outputText });
      }
      if (pathname.startsWith("/themes/")) {
        const assetPath = path.join(repo, "public", pathname.slice(1));
        const body = await readFile(assetPath);
        return route.fulfill({
          contentType: pathname.endsWith(".png") ? "image/png" : "image/webp",
          body,
        });
      }
      return route.fulfill({ contentType: "text/html", body: "<!doctype html>" });
    });

    await page.goto("http://flagship.test/");
    const results = await page.evaluate(async () => {
      const { FLAGSHIP_THEMES } = await import("/lib/appearance/flagship-themes.ts");
      const { getFlagshipMoodVisualProfile } = await import("/lib/appearance/flagship-mood-motion.ts");
      const { createCharacterWallpaperRenderer } = await import("/lib/character-wallpaper-renderer.ts");
      const { getCharacterWallpaperRig } = await import("/lib/character-wallpaper-rigs.ts");
      const { getCharacterPerformance } = await import("/lib/character-wallpaper-parts.ts");

      const report = [];
      for (const flagship of FLAGSHIP_THEMES) {
        const artwork = new Image();
        const atlas = new Image();
        artwork.src = flagship.asset;
        atlas.src = flagship.atlasAsset;
        await Promise.all([artwork.decode(), atlas.decode()]);

        const rig = getCharacterWallpaperRig(flagship.rigId);
        const performance = getCharacterPerformance(flagship.rigId);
        const canvas = document.createElement("canvas");
        const renderer = createCharacterWallpaperRenderer(canvas, artwork, rig, { performance, atlas });
        if (!renderer) throw new Error(`WebGL unavailable for ${flagship.id}`);
        const scale = 0.5;
        renderer.resize(artwork.width * scale, artwork.height * scale);
        const gl = canvas.getContext("webgl");

        function capture(moodName, includeMood = true) {
          if (!moodName) {
            if (!renderer.draw(0)) throw new Error("draw(0) failed");
          } else {
            const profile = getFlagshipMoodVisualProfile(
              { mood: moodName, isBackgroundOnly: false, runningSubagentCount: moodName === "running" ? 1 : 0 },
              flagship.variant,
            );
            const moodArg = includeMood ? {
              beacon: [flagship.beacon.center[0], flagship.beacon.center[1], flagship.beacon.radius, flagship.beacon.haloRadius],
              color: [profile.beaconColor[0], profile.beaconColor[1], profile.beaconColor[2], profile.beaconStrength],
              time: 1.8,
              ripple: moodName === "completed" ? 0.45 : 0,
              particleEnergy: profile.particleEnergy,
              ringCount: profile.ringCount,
              squint: profile.squint,
              tempoScale: profile.tempo,
            } : undefined;
            const ok = renderer.draw(
              1.8,
              { x: profile.gazeBias[0], y: profile.gazeBias[1], attention: profile.gazeLock },
              Infinity,
              1,
              moodArg,
            );
            if (!ok) throw new Error(`draw(${moodName}) failed`);
          }
          const bytes = new Uint8Array(canvas.width * canvas.height * 4);
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
          return bytes;
        }

        const baseCanvas = document.createElement("canvas");
        const baseRenderer = createCharacterWallpaperRenderer(baseCanvas, artwork, rig, { performance, atlas });
        if (!baseRenderer) throw new Error("base WebGL unavailable");
        baseRenderer.resize(artwork.width * scale, artwork.height * scale);
        if (!baseRenderer.draw(0)) throw new Error("base draw(0) failed");
        const baseGl = baseCanvas.getContext("webgl");
        const baseRest = new Uint8Array(baseCanvas.width * baseCanvas.height * 4);
        baseGl.readPixels(0, 0, baseCanvas.width, baseCanvas.height, baseGl.RGBA, baseGl.UNSIGNED_BYTE, baseRest);
        baseRenderer.dispose();

        const restWithoutMood = capture(null);
        let restDiff = 0;
        for (let i = 0; i < restWithoutMood.length; i++) {
          restDiff = Math.max(restDiff, Math.abs(restWithoutMood[i] - baseRest[i]));
        }

        const idleBytes = capture("idle");
        const moodData = {};
        const maxAuraLeftX = Math.floor(canvas.width * 0.45);
        const maxStaticLeftX = Math.floor(canvas.width * 0.38);
        const bx = Math.round((flagship.beacon.center[0] / artwork.width) * canvas.width);
        const by = canvas.height - Math.round((flagship.beacon.center[1] / artwork.height) * canvas.height);

        for (const mood of ["idle", "waiting", "running", "review", "completed", "failed"]) {
          const bytes = mood === "idle" ? idleBytes : capture(mood);
          const plainPoseBytes = capture(mood, false);

          let auraLeftMaxDiff = 0;
          let staticLeftMaxDiff = 0;
          for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < maxAuraLeftX; x++) {
              const idx = (y * canvas.width + x) * 4;
              for (let c = 0; c < 3; c++) {
                auraLeftMaxDiff = Math.max(auraLeftMaxDiff, Math.abs(bytes[idx + c] - plainPoseBytes[idx + c]));
                if (x < maxStaticLeftX) {
                  staticLeftMaxDiff = Math.max(staticLeftMaxDiff, Math.abs(bytes[idx + c] - restWithoutMood[idx + c]));
                }
              }
            }
          }

          let beaconDiff = 0;
          let sumR = 0, sumG = 0, sumB = 0, count = 0;
          for (let dy = -12; dy <= 12; dy++) {
            for (let dx = -12; dx <= 12; dx++) {
              const x = Math.min(canvas.width - 1, Math.max(0, bx + dx));
              const y = Math.min(canvas.height - 1, Math.max(0, by + dy));
              const idx = (y * canvas.width + x) * 4;
              sumR += bytes[idx];
              sumG += bytes[idx + 1];
              sumB += bytes[idx + 2];
              count++;
              beaconDiff = Math.max(
                beaconDiff,
                Math.abs(bytes[idx] - idleBytes[idx]),
                Math.abs(bytes[idx + 1] - idleBytes[idx + 1]),
                Math.abs(bytes[idx + 2] - idleBytes[idx + 2]),
              );
            }
          }

          moodData[mood] = {
            auraLeftMaxDiff,
            staticLeftMaxDiff,
            beaconDiff,
            avgRgb: [sumR / count, sumG / count, sumB / count],
          };
        }

        renderer.dispose();
        report.push({ id: flagship.id, restDiff, moodData });
      }
      return report;
    });

    for (const entry of results) {
      assert.equal(entry.restDiff, 0, `${entry.id}: draw(0) without mood must match base rest frame`);
      for (const mood of ["idle", "waiting", "running", "review", "completed", "failed"]) {
        assert.ok(
          entry.moodData[mood].auraLeftMaxDiff === 0,
          `${entry.id} (${mood}): left reading region (x < 45%) mood aura drift ${entry.moodData[mood].auraLeftMaxDiff} !== 0`,
        );
        assert.ok(
          entry.moodData[mood].staticLeftMaxDiff <= 1,
          `${entry.id} (${mood}): left reading region (x < 38%) rest drift ${entry.moodData[mood].staticLeftMaxDiff} > 1`,
        );
      }
      for (const mood of ["waiting", "running", "review", "completed", "failed"]) {
        assert.ok(
          entry.moodData[mood].beaconDiff >= 8,
          `${entry.id} (${mood}): expected visible beacon change vs idle, got ${entry.moodData[mood].beaconDiff}`,
        );
      }
      const { waiting, review, completed, failed } = entry.moodData;
      // Review (amber) should raise red channel vs waiting (blue)
      assert.ok(review.avgRgb[0] > waiting.avgRgb[0] + 15, `${entry.id}: review amber red > waiting blue red`);
      // Completed (mint green) should raise green channel vs waiting (blue)
      assert.ok(completed.avgRgb[1] > waiting.avgRgb[1] + 5, `${entry.id}: completed mint green > waiting green`);
      // Failed (coral red) should shift red higher relative to blue compared to waiting
      assert.ok((failed.avgRgb[0] - failed.avgRgb[2]) > (waiting.avgRgb[0] - waiting.avgRgb[2]) + 15, `${entry.id}: failed coral shifts red over blue`);
    }
  } finally {
    await browser.close();
  }
});

test("flagship Tier 2 WebM performances decode in Edge, match rest handoff, animate the right half, and lock the left reading area", { timeout: 120000 }, async () => {
  const browser = await chromium.launch({
    ...(process.env.PIORA_BROWSER_EXECUTABLE ? { executablePath: process.env.PIORA_BROWSER_EXECUTABLE }
      : process.platform === "win32" ? { channel: "msedge" } : {}),
    args: ["--enable-unsafe-swiftshader"],
    headless: true,
  });

  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await page.route("http://flagship-video.test/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.startsWith("/lib/")) {
        const rel = pathname.slice(5).replace(/\.ts$/, "");
        const source = await readFile(path.join(repo, "lib", `${rel}.ts`), "utf8");
        const compiled = ts.transpileModule(source, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        });
        return route.fulfill({ contentType: "text/javascript", body: compiled.outputText });
      }
      if (pathname.startsWith("/themes/")) {
        const assetPath = path.join(repo, "public", pathname.slice(1));
        const body = await readFile(assetPath);
        const contentType = pathname.endsWith(".webm")
          ? "video/webm"
          : pathname.endsWith(".png")
            ? "image/png"
            : "image/webp";
        const range = await route.request().headerValue("range");
        if (range) {
          const match = /^bytes=(\d+)-(\d*)$/.exec(range);
          if (match) {
            const start = Number(match[1]);
            const end = match[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1;
            return route.fulfill({
              status: 206,
              headers: {
                "Content-Type": contentType,
                "Accept-Ranges": "bytes",
                "Content-Range": `bytes ${start}-${end}/${body.length}`,
                "Content-Length": String(end - start + 1),
              },
              body: body.subarray(start, end + 1),
            });
          }
        }
        return route.fulfill({
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Accept-Ranges": "bytes",
            "Content-Length": String(body.length),
          },
          body,
        });
      }
      return route.fulfill({ contentType: "text/html", body: "<!doctype html>" });
    });

    await page.goto("http://flagship-video.test/");
    const videoReport = await page.evaluate(async () => {
      const { FLAGSHIP_THEMES } = await import("/lib/appearance/flagship-themes.ts");

      async function seekFrame(video, timeSec) {
        await new Promise((resolve, reject) => {
          const onSeeked = () => {
            cleanup();
            resolve();
          };
          const onErr = () => {
            cleanup();
            reject(new Error(`video error ${video.error?.message || "unknown"}`));
          };
          const cleanup = () => {
            video.removeEventListener("seeked", onSeeked);
            video.removeEventListener("error", onErr);
          };
          video.addEventListener("seeked", onSeeked);
          video.addEventListener("error", onErr);
          video.currentTime = timeSec;
        });
      }

      const reports = [];
      for (const flagship of FLAGSHIP_THEMES) {
        const baseImg = new Image();
        baseImg.src = flagship.asset;
        await baseImg.decode();

        for (const clip of flagship.performances) {
          const video = document.createElement("video");
          video.muted = true;
          video.playsInline = true;
          video.preload = "auto";
          video.src = clip.video;
          await new Promise((resolve, reject) => {
            video.onloadeddata = () => resolve();
            video.onerror = () => reject(new Error(`failed loading ${clip.video}`));
          });

          const w = video.videoWidth;
          const h = video.videoHeight;
          const duration = video.duration;
          const isBakedFlagship = clip.video.startsWith("/themes/piora-flagship/");

          if (!isBakedFlagship) {
            reports.push({
              themeId: flagship.id,
              clipId: clip.id,
              video: clip.video,
              isBakedFlagship,
              w,
              h,
              duration,
            });
            continue;
          }

          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });

          ctx.drawImage(baseImg, 0, 0, w, h);
          const basePixels = ctx.getImageData(0, 0, w, h).data;

          await seekFrame(video, 0.04);
          ctx.drawImage(video, 0, 0, w, h);
          const startPixels = ctx.getImageData(0, 0, w, h).data;

          await seekFrame(video, duration * 0.45);
          ctx.drawImage(video, 0, 0, w, h);
          const peakPixels = ctx.getImageData(0, 0, w, h).data;

          let startBaseDiffSum = 0;
          let startBaseSamples = 0;
          let rightPeakDiff = 0;
          let leftDiffSum = 0;
          let leftPeakDiff = 0;
          let leftWithin8 = 0;
          let leftSamples = 0;
          const leftMaxX = Math.floor(w * 0.38);
          const rightMinX = Math.floor(w * 0.52);

          for (let y = 0; y < h; y += 2) {
            for (let x = 0; x < w; x += 2) {
              const idx = (y * w + x) * 4;
              const sbDiff = (
                Math.abs(startPixels[idx] - basePixels[idx])
                + Math.abs(startPixels[idx + 1] - basePixels[idx + 1])
                + Math.abs(startPixels[idx + 2] - basePixels[idx + 2])
              ) / 3;
              startBaseDiffSum += sbDiff;
              startBaseSamples++;

              const spMax = Math.max(
                Math.abs(peakPixels[idx] - startPixels[idx]),
                Math.abs(peakPixels[idx + 1] - startPixels[idx + 1]),
                Math.abs(peakPixels[idx + 2] - startPixels[idx + 2]),
              );
              const spMean = (
                Math.abs(peakPixels[idx] - startPixels[idx])
                + Math.abs(peakPixels[idx + 1] - startPixels[idx + 1])
                + Math.abs(peakPixels[idx + 2] - startPixels[idx + 2])
              ) / 3;

              if (x < leftMaxX) {
                leftDiffSum += spMean;
                leftPeakDiff = Math.max(leftPeakDiff, spMax);
                if (spMax <= 8) leftWithin8++;
                leftSamples++;
              } else if (x >= rightMinX) {
                rightPeakDiff = Math.max(rightPeakDiff, spMax);
              }
            }
          }

          reports.push({
            themeId: flagship.id,
            clipId: clip.id,
            video: clip.video,
            isBakedFlagship,
            w,
            h,
            duration,
            startBaseMeanDiff: startBaseDiffSum / startBaseSamples,
            rightPeakDiff,
            leftMeanDiff: leftDiffSum / leftSamples,
            leftPeakDiff,
            leftStableRatio: leftWithin8 / leftSamples,
          });
        }
      }
      return reports;
    });

    assert.equal(videoReport.length, 4);
    for (const entry of videoReport) {
      assert.ok(entry.w >= 1600 && entry.h >= 900, `${entry.video}: expected >= 1600x900, got ${entry.w}x${entry.h}`);
      assert.ok(entry.duration >= 2.5, `${entry.video}: expected duration >= 2.5s, got ${entry.duration}`);
      if (entry.isBakedFlagship) {
        assert.ok(entry.startBaseMeanDiff < 8, `${entry.video}: start frame diverges from base painting (${entry.startBaseMeanDiff.toFixed(2)})`);
        assert.ok(entry.rightPeakDiff >= 35, `${entry.video}: insufficient right-half motion (${entry.rightPeakDiff})`);
        assert.ok(entry.leftMeanDiff < 3, `${entry.video}: left reading zone mean drift ${entry.leftMeanDiff.toFixed(2)} >= 3`);
        assert.ok(entry.leftStableRatio >= 0.995, `${entry.video}: left reading zone stable ratio ${entry.leftStableRatio.toFixed(4)} < 0.995`);
        assert.ok(entry.leftPeakDiff < 24, `${entry.video}: left reading zone peak drift ${entry.leftPeakDiff} >= 24`);
      }
    }
  } finally {
    await browser.close();
  }
});

