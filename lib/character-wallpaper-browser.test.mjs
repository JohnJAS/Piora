import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";
import { chromium } from "playwright-core";
import ts from "typescript";

// Rest-pose landmarks measured on the artworks, independent of the animation
// rig. Include raised fingers against faces, hands on props, knees and shoes.
const landmarks = {
  "claude-autumn": { cheekHand: [1193, 251], bookHand: [1196, 524], knee: [1034, 533] },
  "claude-lamp": { cheekHand: [1361, 291], bookHand: [1436, 551], knee: [1322, 701] },
  "claude-paper": { bookHand: [1074, 536], bookCorner: [972, 586], knee: [1025, 626] },
  "ernie-garden": { bookHand: [1126, 421], knee: [1072, 523], shoe: [973, 842] },
  "gemini-prism": { crystalHand: [1110, 393], palm: [1183, 420], knee: [1135, 594] },
  "glm-ink": { chinHand: [1176, 314], bookHand: [1197, 517], knee: [1059, 485] },
  "gpt-cloud": { cheekHand: [1245, 302], bookHand: [1195, 519], knee: [1113, 556] },
  "gpt-ivory": { raisedHand: [1068, 293], restingHand: [1469, 672], knee: [1177, 808] },
  "gpt-orbit": { orbHand: [1095, 350], chairHand: [1484, 755], knee: [1067, 661] },
  "grok-eclipse": { chinHand: [1196, 316], orbHand: [1519, 536], knee: [1353, 606] },
  "kimi-moon": { fluteHand: [1203, 458], otherHand: [1294, 398], knee: [974, 706] },
  "kitty-moon": { cupHand: [1298, 400], otherHand: [1382, 396], knee: [1256, 509] },
  "kitty-ribbon": { leftHand: [1357, 691], rightHand: [1402, 692], bagHandle: [1399, 737] },
  "kitty-strawberry": { cheekHand: [1322, 324], cakeHand: [1544, 409], elbow: [1293, 616] },
  "minimax-coral": { micHand: [1362, 447], foregroundHand: [1432, 680], knee: [1363, 840] },
  "qwen-porcelain": { fanHand: [1267, 442], otherHand: [1307, 471], knee: [1201, 702] },
  "seed-scarf": { leftElbow: [983, 810], rightElbow: [1500, 832] },
  "seed-soda": { toyHand: [1062, 463], knee: [1097, 507], shoe: [861, 864] },
  "whale-abyss": { orbHand: [1147, 419], otherHand: [1206, 420], knee: [1083, 653] },
  "whale-rice": { spoonHand: [1127, 476], bowlHand: [1273, 602], foot: [1062, 840] },
  "whale-tide": { cupHand: [1162, 319], tableHand: [1561, 707], elbow: [1164, 500] },
};

// Landmarks that change color because an authored action carries the feature
// away from its original position or passes directly in front of it.
const movingLandmarks = {
  "claude-autumn": ["cheekHand"],
  "claude-lamp": ["bookHand"],
  "claude-paper": ["bookHand"],
  "ernie-garden": ["bookHand", "shoe"],
  "gemini-prism": ["crystalHand", "palm"],
  "glm-ink": ["chinHand"],
  "gpt-cloud": ["cheekHand"],
  "gpt-ivory": ["raisedHand"],
  "gpt-orbit": ["chairHand"],
  "grok-eclipse": ["chinHand"],
  "kimi-moon": ["fluteHand", "otherHand"],
  "kitty-moon": ["cupHand", "otherHand"],
  "kitty-ribbon": ["bagHandle"],
  "kitty-strawberry": ["cakeHand"],
  "minimax-coral": ["micHand"],
  "seed-soda": ["shoe"],
  "whale-rice": ["spoonHand", "foot"],
  "whale-tide": ["cupHand"],
};

// Pairs identified on the original illustration. A utensil and the hand
// gripping it, or a shoe and its stocking, must keep their separation.
const attachedFeatures = {
  "claude-lamp": { "Lift the open book": [[1558, 460], [1436, 551]] },
  "ernie-garden": { "Shoe taps footrest": [[973, 842], [1028, 809]] },
  "gpt-ivory": { "Crystal-bearing forearm": [[1089, 236], [1090, 303]] },
  "kimi-moon": { "Flute rolls in the upper grip": [[1415, 265], [1294, 398]] },
  "minimax-coral": { "Microphone to lips": [[1340, 361], [1362, 447]] },
  "seed-soda": { "Swinging stocking and shoe": [[861, 864], [925, 755]] },
  "whale-rice": { "Spoon and feeding hand": [[1195, 485], [1127, 476]] },
  "whale-tide": { "Raised teacup and hand": [[1228, 330], [1155, 314]] },
};

// The fallback mesh holds the scene in place underneath the moving cutouts.
async function measurePose({ name, anchors }) {
  const { createCharacterWallpaperRenderer } = await import("/lib/character-wallpaper-renderer");
  const { getCharacterWallpaperRig } = await import("/lib/character-wallpaper-rigs");
  const rig = getCharacterWallpaperRig("character-" + name);
  const artwork = new Image();
  artwork.src = "/art/" + name + ".webp";
  await artwork.decode();
  function makeScene(poseRig) {
    const canvas = document.createElement("canvas");
    const renderer = createCharacterWallpaperRenderer(canvas, artwork, poseRig);
    if (!renderer) throw new Error("WebGL renderer unavailable");
    renderer.resize(artwork.width / 2, artwork.height / 2);
    const gl = canvas.getContext("webgl");
    return {
      dispose: renderer.dispose,
      sample(t, points) {
        if (!renderer.draw(t)) throw new Error("WebGL draw failed");
        const size = 9;
        return points.map(([x, y]) => {
          const tile = new Uint8Array(size * size * 4);
          gl.readPixels(Math.round(x / artwork.width * canvas.width) - 4,
            canvas.height - Math.round(y / artwork.height * canvas.height) - 4,
            size, size, gl.RGBA, gl.UNSIGNED_BYTE, tile);
          return tile;
        });
      },
    };
  }
  function peakDifference(a, b) {
    return a.reduce((max, channel, i) => Math.max(max, Math.abs(channel - b[i])), 0);
  }
  const scene = makeScene(rig);
  const openEyes = makeScene({ ...rig, eyes: rig.eyes.map(eye => [...eye.slice(0, 4), 0, 0]) });
  try {
    const [leftX, leftY, rightX, rightY] = rig.eyes[0];
    const eye = [(leftX + rightX) / 2, (leftY + rightY) / 2];
    const fixed = rig.headContact ? { ...anchors, headContact: rig.headContact } : anchors;
    const points = [...Object.values(fixed), [eye[0], eye[1] - 20], ...rig.sway];
    const rest = scene.sample(0, points);
    const peak = Array(points.length).fill(0);
    for (const t of [1.3, 2.4, 4.1, 6.1]) {
      const pose = scene.sample(t, points);
      pose.forEach((tile, i) => { peak[i] = Math.max(peak[i], peakDifference(tile, rest[i])); });
    }
    const parts = Object.keys(fixed);
    const [head, ...sway] = peak.slice(parts.length);
    // Compare the same pose with the eyelids held open. A moving head alone
    // must not be sufficient to pass the blink control.
    const closedTime = 1.45 + (rig.head[0] % 13) * 0.058 + 0.12;
    const [closed] = scene.sample(closedTime, [eye]);
    const [opened] = openEyes.sample(closedTime, [eye]);
    return { anchors: Object.fromEntries(parts.map((part, i) => [part, peak[i]])),
      head, sway: Math.max(...sway), blink: peakDifference(closed, opened) };
  } finally {
    scene.dispose();
    openEyes.dispose();
  }
}

async function measurePerformance({ name, anchors, movingAnchors, attachments, overlay }) {
  const { createCharacterWallpaperRenderer } = await import("/lib/character-wallpaper-renderer");
  const { getCharacterWallpaperRig } = await import("/lib/character-wallpaper-rigs");
  const { getCharacterPerformance, partBounds } = await import("/lib/character-wallpaper-parts");
  const id = "character-" + name;
  const rig = getCharacterWallpaperRig(id);
  const performance = getCharacterPerformance(id);
  const artwork = new Image();
  const atlas = new Image();
  artwork.src = "/art/" + name + ".webp";
  atlas.src = "/art/motion/" + name + ".png";
  await Promise.all([artwork.decode(), atlas.decode()]);
  const failures = [];
  const boxes = performance.parts.map(partBounds);
  for (const name of Object.keys(attachments)) {
    if (!performance.parts.some(part => part.name === name)) failures.push("missing attached feature " + name);
  }
  if (boxes.reduce((total, box) => total + box[2], 0) !== atlas.width ||
    Math.max(...boxes.map(box => box[3])) !== atlas.height)
    return ["motion atlas dimensions do not match the authored cutouts"];
  function scene(image, layers, scale = 0.5) {
    const canvas = document.createElement("canvas");
    const renderer = createCharacterWallpaperRenderer(canvas, image, rig, layers);
    if (!renderer) throw new Error("WebGL unavailable");
    renderer.resize(artwork.width * scale, artwork.height * scale);
    const gl = canvas.getContext("webgl");
    return {
      dispose: renderer.dispose,
      frame(time, look, sinceGreeting, amount) {
        if (!renderer.draw(time, look, sinceGreeting, amount)) throw new Error("WebGL draw failed");
        const bytes = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        return bytes;
      },
      width: canvas.width, height: canvas.height,
    };
  }
  const layers = { performance, atlas };
  const moving = scene(artwork, layers);
  const base = scene(artwork);
  const frozen = scene(artwork, {
    atlas, performance: {
      ...performance,
      parts: performance.parts.map(part => ({ ...part, angle: 0, parent: undefined }))
    }
  });
  function shownChanges(a, b) {
    let pixels = 0;
    for (let i = 0; i < a.length; i += 4) {
      const delta = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      if (delta * (1 - overlay / 100) >= 6) pixels++;
    }
    return pixels;
  }
  try {
    const rest = moving.frame(0);
    const original = base.frame(0);
    if (rest.some((value, i) => value !== original[i])) failures.push("cutouts alter the rest painting");
    const time = performance.beats[2] + Math.max(...performance.parts.map(p => p.follow));
    const active = moving.frame(time);
    if (id === "character-whale-tide") {
      const handoff = moving.frame(time, { x: 1, y: 1, attention: 1 }, time, 0);
      if (handoff.some((value, i) => value !== original[i])) failures.push("camera leaves a displaced idle pose");
    }
    if (shownChanges(active, frozen.frame(time)) < 60) failures.push("signature action invisible through theme overlay");
    if (shownChanges(active, moving.frame(time, { x: 1, y: 0.6, attention: 1 })) < 20) failures.push("unresponsive to pointer");
    const betweenActions = performance.beats[5] - 0.3;
    if (shownChanges(moving.frame(betweenActions), moving.frame(betweenActions, undefined, time)) < 60) {
      failures.push("touch does not trigger a visible action between idle gestures");
    }
    for (const [part, [x, y]] of Object.entries(anchors)) {
      const cx = Math.round(x / artwork.width * moving.width);
      const cy = moving.height - Math.round(y / artwork.height * moving.height);
      let drift = 0;
      for (let yy = cy - 3; yy <= cy + 3; yy++) for (let xx = cx - 3; xx <= cx + 3; xx++) {
        const i = (yy * moving.width + xx) * 4;
        for (let channel = i; channel < i + 3; channel++) {
          drift = Math.max(drift, Math.abs(active[channel] - rest[channel]));
        }
      }
      if (movingAnchors.includes(part)) {
        if (drift < 3) failures.push(part + " does not leave its rest landmark");
      } else if (drift > 1) {
        failures.push(part + " moves despite being planted");
      }
    }
  } finally {
    moving.dispose();
    base.dispose();
    frozen.dispose();
  }

  // Track two registration marks painted onto the input texture for each
  // authored part. Duplicating the original under the cutout also duplicates
  // a mark, so centroid alone is insufficient: its area must survive too.
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = atlas.width;
  maskCanvas.height = atlas.height;
  const mask = maskCanvas.getContext("2d", { willReadFrequently: true });
  mask.drawImage(atlas, 0, 0);
  let packedX = 0;
  for (const part of performance.parts) {
    const [bx, by, w, h] = partBounds(part);
    const alpha = mask.getImageData(packedX, 0, w, h).data;
    packedX += w;
    const candidates = [];
    for (let y = 4; y < h - 4; y += 2) for (let x = 4; x < w - 4; x += 2) {
      if ([-3, 0, 3].every(dy => [-3, 0, 3].every(dx => alpha[((y + dy) * w + x + dx) * 4 + 3] > 250))) {
        const px = bx + x, py = by + y;
        const edge = Math.min(px, py, artwork.width - px, artwork.height - py);
        // Cropped fabric stays attached at the frame edge. Track an interior
        // feature instead of a continuation that would lie off canvas.
        if (edge > 4) candidates.push([px, py, Math.hypot(px - part.pivot[0], py - part.pivot[1]), edge]);
      }
    }
    function reach(p) {
      const edge = part.rigid ? 1 : Math.min(1, p[3] / 54);
      const tether = part.tether
        ? Math.min(1, Math.hypot(p[0] - part.tether[0], p[1] - part.tether[1]) / part.tether[2])
        : 1;
      return p[2] * edge * tether;
    }
    candidates.sort((a, b) => reach(b) - reach(a));
    const tip = candidates[0];
    const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const other = tip && candidates.find(point =>
      point[2] > tip[2] * 0.36 && distance(point, tip) > Math.max(12, tip[2] * 0.2));
    if (!other) {
      failures.push(part.name + " has insufficient separated interior detail");
      continue;
    }
    const pairs = [[tip, other]];
    if (attachments[part.name]) pairs.push(attachments[part.name]);
    for (const pair of pairs) {
      const source = document.createElement("canvas");
      source.width = artwork.width;
      source.height = artwork.height;
      const ctx = source.getContext("2d");
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, source.width, source.height);
      pair.forEach(([x, y], i) => {
        ctx.fillStyle = i ? "#00ff00" : "#ff00ff";
        ctx.fillRect(x - 3, y - 3, 6, 6);
      });
      const marked = new Image();
      marked.src = source.toDataURL();
      await marked.decode();
      const probes = scene(marked, layers, 1);
      function positions(bytes) {
        const sums = [[0, 0, 0], [0, 0, 0]];
        for (let i = 0; i < bytes.length; i += 4) {
          const r = bytes[i], g = bytes[i + 1], b = bytes[i + 2];
          const color = r > 190 && b > 190 && g < 30 ? 0 : g > 190 && r < 30 && b < 30 ? 1 : -1;
          if (color < 0) continue;
          sums[color][0] += (i / 4 % probes.width + 0.5) * artwork.width / probes.width;
          sums[color][1] += (probes.height - 0.5 - Math.floor(i / 4 / probes.width)) * artwork.height / probes.height;
          sums[color][2]++;
        }
        return sums.map(([x, y, n]) => [x / n, y / n, n]);
      }
      try {
        const rest = positions(probes.frame(0));
        const posed = positions(probes.frame(performance.beats[2] + part.follow));
        if (rest.some((point, i) => point[2] < 4 || posed[i][2] < point[2] * 0.45 || posed[i][2] > point[2] * 1.55)) {
          failures.push(part.name + " loses or duplicates its painted detail");
        }
        const travel = distance(rest[0], posed[0]);
        if (!(travel >= 8)) failures.push(part.name + " tip moves only " + travel.toFixed(1) + " source pixels");
        const length = distance(rest[0], rest[1]);
        if ((part.rigid || pair === attachments[part.name]) &&
            Math.abs(distance(posed[0], posed[1]) - length) > Math.max(2.3, length * 0.065)) {
          failures.push(part.name + " stretches between attached features");
        }
        if (part.parent) {
          // The shoulder first carries the elbow through an arc; the wrist then
          // rotates about the carried elbow. Check the measured tip against that
          // construction at the authored accent, allowing the idle follow-through.
          function rotate(point, pivot, degrees) {
            const rad = degrees * Math.PI / 180;
            const x = point[0] - pivot[0], y = point[1] - pivot[1];
            return [
              pivot[0] + x * Math.cos(rad) - y * Math.sin(rad),
              pivot[1] + x * Math.sin(rad) + y * Math.cos(rad),
            ];
          }
          const wrist = rotate(rest[0], part.pivot, part.angle);
          const expected = rotate(wrist, part.parent, part.parent[3]);
          if (distance(expected, posed[0]) > 2 + 0.15 * distance(expected, rest[0]))
            failures.push(part.name + " separates from the rotating upper arm");
        }
      } finally { probes.dispose(); }
    }
  }
  return failures;
}

async function measureTeacupPortrait() {
  const { createCharacterWallpaperRenderer } = await import("/lib/character-wallpaper-renderer");
  const { getCharacterWallpaperRig } = await import("/lib/character-wallpaper-rigs");
  const { getCharacterPerformance } = await import("/lib/character-wallpaper-parts");
  const id = "character-whale-tide";
  const image = new Image(), atlas = new Image();
  image.src = "/art/whale-tide.webp";
  atlas.src = "/art/motion/whale-tide.png";
  await Promise.all([image.decode(), atlas.decode()]);
  const canvas = document.createElement("canvas");
  const renderer = createCharacterWallpaperRenderer(canvas, image, getCharacterWallpaperRig(id), {
    performance: getCharacterPerformance(id), atlas,
  }, { focusX: 0.8, maxPixels: 2560 * 1440 });
  if (!renderer) throw new Error("WebGL unavailable");
  renderer.resize(image.width, image.height);
  // All coordinates below are measured at 1:1 in this cutout of the painting.
  const crop = document.createElement("canvas");
  crop.width = 496;
  crop.height = 520;
  const ctx = crop.getContext("2d", { willReadFrequently: true });
  function frame(time, look) {
    if (!renderer.draw(time, look)) throw new Error("WebGL draw failed");
    ctx.drawImage(canvas, 1020, 55, crop.width, crop.height, 0, 0, crop.width, crop.height);
    return ctx.getImageData(0, 0, crop.width, crop.height).data;
  }
  const index = (x, y) => 4 * (y * crop.width + x);
  const rest = frame(0);
  // Match small, distinctive patches of the actual illustration in RGB space.
  // Eyelash tips lie outside the iris, which moves intentionally during gaze.
  const landmarks = [[204,127], [263,103], [191,170], [310,127], [248,172],
    [254,197], [272,191], [271,224], [221,209], [308,194]];
  function locate(bytes, [x, y], radius = 18) {
    let best = Infinity, match = [x, y];
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      let error = 0;
      for (let v = -5; v <= 5 && error <= best; v += 2) for (let u = -5; u <= 5; u += 2) {
        const a = index(x + u, y + v), b = index(x + u + dx, y + v + dy);
        for (let c = 0; c < 3; c++) error += (rest[a+c] - bytes[b+c]) ** 2;
      }
      if (error < best) { best = error; match = [x + dx, y + dy]; }
    }
    return match;
  }
  function faceError(bytes, dx, dy) {
    let error = 0, channels = 0;
    for (let y = 104; y <= 220; y += 2) for (let x = 194; x <= 314; x += 2) {
      if (((x-254)/60) ** 2 + ((y-162)/58) ** 2 > 1) continue;
      if ((x < 243 && y >= 141 && y <= 188) || (x > 258 && y <= 158)) continue;
      const a = index(x, y), b = index(x + dx, y + dy);
      for (let c = 0; c < 3; c++) { error += Math.abs(rest[a+c] - bytes[b+c]); channels++; }
    }
    return error / channels;
  }
  function armSections(bytes, y) {
    const runs = [];
    let start, last;
    for (let x = 85; x < 170; x++) {
      const i = index(x, y), r = bytes[i], g = bytes[i+1], b = bytes[i+2];
      // The skin is warm pink. The hair behind it is blue and the cuff is white.
      if (r <= g + 10 || r <= b + 9 || g <= 105) continue;
      if (last !== undefined && x - last > 3) {
        if (last - start >= 3) runs.push(last - start + 1);
        start = undefined;
      }
      start ??= x;
      last = x;
    }
    if (last - start >= 3) runs.push(last - start + 1);
    return runs;
  }
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const failures = new Set();
  try {
    for (const [time, look] of [[1.25], [2.5], [3.12, { x: 1, y: 0.35, attention: 1 }], [4]]) {
      const posed = frame(time, look);
      const points = landmarks.map(point => locate(posed, point));
      // Breathing may translate the face by a couple of source pixels. The
      // eyebrows, lash corners, nose, lips and jaw must agree on that motion.
      for (const [i, point] of points.entries()) {
        if (distance(point, landmarks[i]) > 3) failures.add("facial landmark leaves the breathing portrait");
        for (let j = 0; j < i; j++) {
          if (Math.abs(distance(point, points[j]) - distance(landmarks[i], landmarks[j])) > 2.4)
            failures.add("eyes, nose, lips and jaw change their spacing");
        }
      }
      const shifts = [0, 1].map(axis => points.map((p, i) => p[axis] - landmarks[i][axis])
        .sort((a, b) => a - b)[Math.floor(points.length / 2)]);
      if (faceError(posed, ...shifts) > 6) failures.add("painted face stretches around its lower contour");
      // A split below the wrist can leave two narrow skin-colored runs with a
      // stripe of hair between them. The original has one continuous section.
      for (const y of [305, 313, 321, 329, 337, 345, 349]) {
        const [width] = armSections(rest, y);
        const runs = armSections(posed, y);
        if (runs.length !== 1 || runs[0] < width * 0.8 || runs[0] > width * 1.25)
          failures.add("forearm separates or narrows between the hand and cuff");
      }
      if (time !== 2.5) continue;
      const knuckle = [131, 247], handle = [173, 241];
      const grip = locate(posed, knuckle, 38), ring = locate(posed, handle, 38);
      if (distance(ring, handle) < 10 || Math.abs(distance(grip, ring) - distance(knuckle, handle)) > 3)
        failures.add("teacup handle separates from its fingers");
      // Trace the outer right porcelain edge in its REST position. At the
      // accent this curve is over blue hair. Several bright adjacent samples
      // tracing that same arc mean the original cup outline is still painted.
      const oldRim = [[244,236], [243,238], [240,246], [240,248], [237,252], [237,254],
        [237,256], [236,258], [235,260], [234,262], [233,264]];
      const highlights = oldRim.filter(([x, y]) => {
        const red = dx => posed[index(x + dx, y)];
        return red(0) - (red(-3) + red(3)) / 2 > 25;
      });
      if (highlights.length > 4) failures.add("former teacup rim remains outlined on the hair");
    }
    // At 1:1, cropping 220 source pixels at 80% puts the left edge at 176.
    // The eyes and teacup must land in the same place as the CSS wallpaper.
    renderer.resize(image.width - 220, image.height);
    renderer.draw(0, undefined, Infinity, 0);
    ctx.drawImage(canvas, 1020 - 176, 55, crop.width, crop.height, 0, 0, crop.width, crop.height);
    const narrow = ctx.getImageData(0, 0, crop.width, crop.height).data;
    ctx.drawImage(image, 1020, 55, crop.width, crop.height, 0, 0, crop.width, crop.height);
    const painted = ctx.getImageData(0, 0, crop.width, crop.height).data;
    const error = narrow.reduce((sum, value, i) => sum + Math.abs(value - painted[i]), 0) / narrow.length;
    if (error > 1.5) failures.add("portrait shifts when the narrow desktop starts the performance");
    return [...failures];
  } finally {
    renderer.dispose();
  }
}

test("character wallpaper performances move distinct painted parts while preserving contacts", { timeout: 180000 }, async () => {
  const assets = new URL("../public/themes/character-backgrounds/", import.meta.url);
  assert.deepEqual(Object.keys(landmarks).sort(), (await readdir(assets))
    .filter(file => file.endsWith(".webp")).map(file => file.slice(0, -5)).sort());
  const browser = await chromium.launch({
    ...(process.env.PIORA_BROWSER_EXECUTABLE ? { executablePath: process.env.PIORA_BROWSER_EXECUTABLE }
      : process.platform === "win32" ? { channel: "msedge" } : {}),
    args: ["--enable-unsafe-swiftshader"], headless: true,
  });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await page.route("http://wallpaper.test/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.startsWith("/lib/")) {
        const source = await readFile(new URL("." + pathname.slice(4) + ".ts", import.meta.url), "utf8");
        const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
        return route.fulfill({ contentType: "text/javascript", body: compiled.outputText });
      }
      if (pathname.startsWith("/art/")) return route.fulfill({ contentType: pathname.endsWith(".png") ? "image/png" : "image/webp", body: await readFile(new URL(pathname.slice(5), assets)) });
      return route.fulfill({ contentType: "text/html", body: "<!doctype html>" });
    });
    await page.goto("http://wallpaper.test/");
    const failures = [];
    const { CHARACTER_THEMES } = await createJiti(import.meta.url).import("./character-themes.ts");
    for (const [name, anchors] of Object.entries(landmarks)) {
      const pose = await page.evaluate(measurePose, { name, anchors });
      for (const [part, peak] of Object.entries(pose.anchors)) {
        if (peak > 1) failures.push(name + "/" + part + ": peak RGB drift " + peak);
      }
      if (pose.head < 5 || pose.sway < 5 || pose.blink < 15) {
        failures.push(name + ": missing head, hair/cloth or eye motion " + JSON.stringify(pose));
      }
      const { overlay } = CHARACTER_THEMES.find(theme => theme.id === "character-" + name);
      for (const issue of await page.evaluate(measurePerformance, {
        name, anchors, movingAnchors: movingLandmarks[name] ?? [], attachments: attachedFeatures[name] ?? {}, overlay,
      }))
        failures.push(name + "/" + issue);
    }
    for (const issue of await page.evaluate(measureTeacupPortrait)) failures.push("whale-tide/" + issue);
    assert.deepEqual(failures, []);
  } finally {
    await browser.close();
  }
});
