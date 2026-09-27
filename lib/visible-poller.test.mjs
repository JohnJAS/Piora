import assert from "node:assert/strict";
import test from "node:test";
import { startVisiblePolling } from "./visible-poller.ts";

const settle = () => new Promise(resolve => setImmediate(resolve));
test("hidden surfaces do no work, resume immediately and never overlap ignored aborts", async () => {
  let visible = false, changed, release, calls = 0, signal, unsubscribed = false;
  const polling = startVisiblePolling({ intervalMs: 60_000, isVisible: () => visible,
    subscribe: callback => { changed = callback; return () => { unsubscribed = true; }; },
    poll: async value => { calls++; signal = value; await new Promise(resolve => { release = resolve; }); },
  });
  try {
    await settle(); assert.equal(calls, 0);
    visible = true; changed(); await settle(); assert.equal(calls, 1);
    polling.refresh(); polling.refresh(); await settle(); assert.equal(calls, 1);
    visible = false; changed(); assert.equal(signal.aborted, true);
    visible = true; changed(); await settle(); assert.equal(calls, 1);
    release(); await settle(); await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(calls, 2);
    polling.stop(); assert.equal(signal.aborted, true); assert.equal(unsubscribed, true);
    release(); await settle(); polling.refresh(); assert.equal(calls, 2);
  } finally { polling.stop(); release?.(); }
});

test("a slow poll schedules the next tick after completion and failures retry", async () => {
  let calls = 0, inFlight = 0, peak = 0;
  const polling = startVisiblePolling({ intervalMs: 5, isVisible: () => true, subscribe: () => () => {},
    poll: async () => {
      calls++; peak = Math.max(peak, ++inFlight);
      await new Promise(resolve => setTimeout(resolve, 15)); inFlight--;
      if (calls === 1) throw new Error("offline");
    },
  });
  try { await new Promise(resolve => setTimeout(resolve, 75)); assert.ok(calls >= 2); assert.equal(peak, 1); }
  finally { polling.stop(); }
});
