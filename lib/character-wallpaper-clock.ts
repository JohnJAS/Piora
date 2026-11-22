/** Schedule at most one draw per display refresh and report actual active seconds. */
export function createWallpaperFrameClock(fps: 30 | 60) {
  const interval = 1000 / fps;
  let lastPaint: number | null = null;
  let nextPaint = 0;

  return {
    sample(now: number) {
      // A display refresh can arrive slightly ahead of a nominal deadline.
      if (lastPaint !== null && now < nextPaint - 1) return null;
      const seconds = lastPaint === null ? 0 : (now - lastPaint) / 1000;
      // Keep fractional refresh time at 90/144 Hz. If a full deadline was
      // skipped, restart from this paint rather than drawing missed frames.
      const deadline = lastPaint === null || now - nextPaint >= interval ? now : nextPaint;
      nextPaint = deadline + interval;
      lastPaint = now;
      return seconds;
    },
    reset() {
      lastPaint = null;
    },
  };
}
