import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { createWallpaperFrameClock } = await createJiti(import.meta.url).import("./character-wallpaper-clock.ts");

for (const fps of [30, 60]) {
  test(`wallpaper holds ${fps} fps on standard and high refresh displays`, () => {
    for (const hz of [60, 90, 120, 144, 165]) {
      const clock = createWallpaperFrameClock(fps);
      let draws = 0;
      let seconds = 0;
      let lastDraw = 0;
      for (let i = 0; i < hz * 10; i++) {
        const now = i * 1000 / hz;
        const delta = clock.sample(now);
        if (delta === null) continue;
        assert.equal(delta, (now - lastDraw) / 1000);
        lastDraw = now;
        draws++;
        seconds += delta;
      }
      assert.equal(draws, fps * 10, `${hz} Hz display`);
      assert.ok(Math.abs(seconds - lastDraw / 1000) < 1e-8);
    }
  });
}

test("resuming focus starts a new draw without adding time spent paused", () => {
  const clock = createWallpaperFrameClock(60);
  assert.equal(clock.sample(100), 0);
  assert.equal(clock.sample(117), .017);
  clock.reset();
  assert.equal(clock.sample(30117), 0);
  assert.equal(clock.sample(30123), null);
  assert.equal(clock.sample(30134), .017);
});

test("a delayed refresh advances real time once and drops missed draw deadlines", () => {
  const clock = createWallpaperFrameClock(60);
  assert.equal(clock.sample(0), 0);
  assert.equal(clock.sample(17), .017);
  assert.equal(clock.sample(951), .934);
  assert.equal(clock.sample(951), null);
  assert.equal(clock.sample(957), null);
  assert.equal(clock.sample(968), .017);
});
