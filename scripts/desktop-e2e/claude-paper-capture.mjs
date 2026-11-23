import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const POSES = [
  ["idle", "idle"], ["page-turn", "working_tools"], ["chin-rest", "thinking"], ["wave", "greet"],
];

const stats = values => {
  const sorted = values.slice().sort((a, b) => a - b);
  assert.ok(sorted.length, "Timing sample is empty");
  const pick = p => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
  return { samples: sorted.length, median: pick(0.5), p95: pick(0.95), p99: pick(0.99),
    max: sorted.at(-1), over50ms: sorted.filter(x => x > 50).length,
    over67ms: sorted.filter(x => x > 67).length, over100ms: sorted.filter(x => x > 100).length };
};
const gaps = times => times.slice(1).map((time, i) => time - times[i]);

export async function captureGestureTransitions(page, directory, signal) {
  const folder = join(directory, "gesture-keyframes");
  await mkdir(folder);
  const clip = await page.evaluate(() => ({
    x: Math.floor(innerWidth * 0.42), y: Math.floor(innerHeight * 0.11),
    width: Math.floor(innerWidth * 0.575), height: Math.floor(innerHeight * 0.63),
  }));
  const transitions = [];
  try {
    for (const [from, fromState] of POSES) {
      for (const [to, toState] of POSES) {
        if (from === to) continue;
        let tick = 0;
        const frames = [];
        for (const advance of [0, 3, 1, 2, 4, 15]) {
          signal.throwIfAborted();
          tick += advance;
          const state = await page.evaluate(([fromState, toState, advance]) => window.__pioraPuppetDebug.stepFrames(
            advance === 0 ? fromState : toState, advance || 33, advance === 0
          ), [fromState, toState, advance]);
          assert.equal(state.running, false);
          if (tick === 0 || tick === 25) assert.ok(state.hand[POSES.findIndex(([pose]) => pose === (tick ? to : from))] > 0.999);
          const filename = `${from}-to-${to}-${String(tick).padStart(2, "0")}.png`;
          await page.screenshot({ path: join(folder, filename), clip, scale: "css" });
          frames.push({ filename, elapsedMs: tick / 30 * 1000, weights: state.hand });
        }
        transitions.push({ from, to, frames });
      }
    }
  } finally {
    await page.evaluate(() => window.__pioraPuppetDebug?.resume());
    await writeFile(join(folder, "index.json"), JSON.stringify({ clip, transitions }, null, 2));
  }
}

function runtimeStats(timing, start, end) {
  const raf = timing.raf.filter(at => at >= start && at <= end);
  const draws = timing.draws.filter(draw => draw.raf >= start && draw.raf <= end);
  return { draws: draws.length, rate: (draws.length - 1) * 1000 / (draws.at(-1).raf - draws[0].raf),
    rafIntervalsMs: stats(gaps(raf)), drawIntervalsMs: stats(gaps(draws.map(draw => draw.raf))),
    drawSubmissionCpuMs: stats(draws.map(draw => draw.cpuMs)) };
}

const GATE_BEATS = [
  ["idle", 4050], ["user_typing", 800], ["thinking", 1000], ["working_tools", 1000],
  ["streaming", 1450], ["success", 950], ["error", 900], ["sleepy", 950],
];

async function playGatePreview(page, signal, scene) {
  const clickTarget = await page.evaluate(() => ({ x: Math.round(innerWidth * 0.93), y: Math.round(innerHeight * 0.49) }));
  await page.waitForFunction(() => {
    const state = window.__pioraPuppetDebug?.snapshot();
    return state?.running && state.liveState === "idle";
  });
  const clock = await page.evaluate(({ x, y }) => {
    const puppet = window.__pioraPuppetDebug;
    const initialDraw = puppet.snapshot().framesDrawn;
    const samples = [];
    const longTasks = [];
    const appendTasks = entries => {
      for (const entry of entries) longTasks.push({ at: entry.startTime, duration: entry.duration });
    };
    const tracksLongTasks = PerformanceObserver.supportedEntryTypes.includes("longtask");
    const monitor = tracksLongTasks ? new PerformanceObserver(entries => appendTasks(entries.getEntries())) : null;
    monitor?.observe({ type: "longtask" });
    let lastDraw = initialDraw, sampler, click;
    const readDraw = () => {
      const sample = puppet.snapshot();
      if (sample.framesDrawn !== lastDraw) {
        samples.push(sample);
        lastDraw = sample.framesDrawn;
      }
    };
    const poll = () => {
      readDraw();
      sampler = requestAnimationFrame(poll);
    };
    const pointerUp = event => {
      if (!event.isTrusted || event.button !== 0 || !event.isPrimary
        || Math.abs(event.clientX - x) > 1 || Math.abs(event.clientY - y) > 1) return;
      const before = puppet.snapshot();
      if (before.state !== "sleepy") return;
      click = { at: performance.timeOrigin + performance.now(), trusted: event.isTrusted, button: event.button,
        x: event.clientX, y: event.clientY, stateBefore: before.state, liveStateBefore: before.liveState };
      // Clear only the rehearsal override before the application's pointer-up
      // handler runs in this same event. The real handler owns the greeting.
      puppet.setState(null);
    };
    window.addEventListener("pointerup", pointerUp, true);
    const started = puppet.startTiming();
    sampler = requestAnimationFrame(poll);
    window.__pioraGatePreviewProbe = () => {
      cancelAnimationFrame(sampler);
      window.removeEventListener("pointerup", pointerUp, true);
      if (monitor) {
        appendTasks(monitor.takeRecords());
        monitor.disconnect();
      }
      readDraw();
      const result = { at: performance.now(), timing: puppet.stopTiming(), samples, click, tracksLongTasks, longTasks };
      puppet.setState(null);
      delete window.__pioraGatePreviewProbe;
      return result;
    };
    return { origin: performance.timeOrigin, started, initialDraw };
  }, clickTarget);
  const beats = [];
  let end;
  try {
    for (const [state, milliseconds] of GATE_BEATS) {
      const at = await page.evaluate(state => {
        const puppet = window.__pioraPuppetDebug;
        puppet.setState(state);
        if (state === "idle") puppet.playPageTurn();
        return performance.now();
      }, state);
      beats.push({ state, at: clock.origin + at,
        trigger: state === "idle" ? scene === "paper" ? "debug-page-turn" : "debug-idle-vignette" : "debug-state" });
      await delay(state === "idle" && scene !== "paper" ? 5200 : milliseconds, undefined, { signal });
    }
    await page.mouse.click(clickTarget.x, clickTarget.y);
    await delay(1650, undefined, { signal });
  } finally {
    end = await page.evaluate(() => window.__pioraGatePreviewProbe?.());
  }
  assert.ok(end?.click, "The recording must end with a trusted pointer-up from sleepy");
  beats.push({ state: "greet", at: end.click.at, trigger: "trusted-pointerup" });
  const samples = end.samples.map(sample => {
    const draw = end.timing.draws[sample.framesDrawn - clock.initialDraw - 1];
    assert.ok(draw, "Every sampled pose must correspond to a measured render");
    return { ...sample, at: clock.origin + draw.finished };
  });
  return { beats, timing: end.timing, origin: clock.origin, start: clock.started, end: end.at,
    tracksLongTasks: end.tracksLongTasks, longTasks: end.longTasks,
    observed: { samples, click: end.click } };
}

function pacingWindow(name, recording, data) {
  const summary = runtimeStats(data.timing, data.start, data.end);
  const draws = data.timing.draws.filter(draw => draw.raf >= data.start && draw.raf <= data.end);
  const raf = data.timing.raf.filter(at => at >= data.start && at <= data.end);
  const longGaps = [];
  for (let index = 1; index < draws.length; index++) {
    const start = draws[index - 1].raf, end = draws[index].raf;
    if (end - start < 50) continue;
    const callbacksBetween = raf.filter(at => start < at && at < end).length;
    const overlappingLongTasks = data.longTasks.filter(task => task.at < end && task.at + task.duration > start);
    longGaps.push({ offsetMs: start - data.start, gapMs: end - start, callbacksBetween, overlappingLongTasks });
  }
  return { name, screencast: recording, durationMs: data.end - data.start, ...data, summary, longGaps };
}

function proveGatePreview(observed, frames, beats, scene) {
  const spans = [];
  for (const sample of observed.samples) {
    if (spans.at(-1)?.state !== sample.state) spans.push({ state: sample.state, firstAt: sample.at, samples: 0 });
    const span = spans.at(-1);
    span.lastAt = sample.at;
    span.samples++;
  }
  assert.deepEqual(spans.map(span => span.state), [...GATE_BEATS.map(([state]) => state), "greet"]);
  for (const [index, span] of spans.entries()) {
    const next = spans[index + 1]?.firstAt ?? frames.at(-1).at + 1;
    span.sourceFrames = frames.filter(frame => frame.at >= span.firstAt && frame.at < next).length;
    span.cueAt = beats[index].at;
    span.trigger = beats[index].trigger;
    assert.ok(span.sourceFrames >= 5, span.state + " must be represented in the actual capture");
  }
  const idle = observed.samples.filter(sample => sample.state === "idle");
  const stream = observed.samples.filter(sample => sample.state === "streaming");
  const greet = observed.samples.filter(sample => sample.state === "greet");
  const peakPageLift = Math.max(...idle.map(sample => sample.pageLift));
  const peakPageHand = Math.max(...idle.map(sample => sample.hand[1]));
  const mouthClosed = Math.max(...stream.map(sample => sample.mouth[0]));
  const mouthOpen = Math.max(...stream.map(sample => sample.mouth[2]));
  const waveHand = Math.max(...greet.map(sample => sample.hand[3]));
  const story = {
    peakPageLift, peakPageHand,
    peakCarry: Math.max(...idle.map(sample => sample.carry)),
    peakGlow: Math.max(...idle.map(sample => sample.glow)),
    peakChin: Math.max(...idle.map(sample => sample.hand[2])),
    wristTravel: Math.max(...idle.map(sample => Math.hypot(...sample.wrist))),
    peakSmile: Math.max(...idle.map(sample => sample.expression[1])),
  };
  assert.ok(idle.some(sample => sample.vignettePlaying) && !idle.at(-1).vignettePlaying && peakPageHand > 0.8);
  if (scene === "lamp") {
    const pickup = idle.filter(sample => sample.carry > 0.9);
    assert.ok(story.peakGlow > 0.85 && pickup.length > 15 && idle.at(-1).carry < 0.01);
    assert.ok(Math.max(...pickup.map(sample => sample.gaze[0])) - Math.min(...pickup.map(sample => sample.gaze[0])) > 0.65);
  } else {
    assert.ok(idle.some(sample => sample.pageTurning) && peakPageLift > 0.85
      && idle.at(-1).pageLift < 0.01, "Idle must show a complete lifted page and settle");
    if (scene === "autumn") {
      assert.ok(story.peakChin > 0.85 && story.wristTravel > 3);
      assert.ok(idle.findIndex(sample => sample.hand[2] > 0.85)
        < idle.findIndex(sample => Math.hypot(...sample.wrist) > 3));
    }
  }
  assert.ok(story.peakSmile > 0.68);
  assert.ok(mouthClosed > 0.8 && mouthOpen > 0.65, "Streaming must show both closed and open mouth cels");
  assert.ok(observed.click.stateBefore === "sleepy" && observed.click.liveStateBefore === "idle"
    && greet.every(sample => sample.liveState === "greet") && waveHand > 0.95, "The live click must drive the wave pose");
  return { scene, spans, click: observed.click, ...story, mouthClosed, mouthOpen, waveHand };
}

export async function recordClaudePaper(page, directory, signal, { orderedPreview = false, scene = "paper" } = {}) {
  const folder = join(directory, "recording-frames");
  await mkdir(folder);
  const comparePacing = orderedPreview && scene !== "paper";
  const pacing = [];
  if (comparePacing) {
    const warm = await playGatePreview(page, signal, scene);
    pacing.push(pacingWindow("same sequence before capture", false, warm));
    await writeFile(join(directory, "runtime-before-capture.json"), JSON.stringify(pacing[0], null, 2));
  }
  const client = await page.context().newCDPSession(page);
  const frames = [], payloads = [], cues = [];
  const receive = ({ data, metadata, sessionId }) => {
    void client.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    if (metadata.timestamp === undefined) return;
    const filename = String(frames.length).padStart(5, "0") + ".jpg";
    frames.push({ filename, at: metadata.timestamp * 1000, receivedAt: Date.now() });
    payloads.push(data);
  };
  client.on("Page.screencastFrame", receive);
  const schedule = [
    ["idle", 3450], ["user_typing", 660], ["working_tools", 700], ["thinking", 700], ["waiting_approval", 700],
    ["streaming", 1050], ["thinking", 700], ["working_tools", 700], ["success", 700], ["working_tools", 700],
    ["error", 700], ["greet", 700], ["thinking", 700], ["sleepy", 900],
  ];
  async function rehearse() {
    const clock = await page.evaluate(() => {
      const puppet = window.__pioraPuppetDebug;
      return { origin: performance.timeOrigin, started: puppet.startTiming() };
    });
    const beats = [];
    try {
      for (const [state, milliseconds] of schedule) {
        const at = await page.evaluate(state => {
          const puppet = window.__pioraPuppetDebug;
          puppet.setState(state);
          if (state === "idle") puppet.playPageTurn();
          return performance.now();
        }, state);
        beats.push({ state, at: clock.origin + at });
        await delay(milliseconds, undefined, { signal });
      }
    } finally {
      await page.evaluate(() => window.__pioraPuppetDebug.setState(null));
    }
    const end = await page.evaluate(() => ({ at: performance.now(), timing: window.__pioraPuppetDebug.stopTiming() }));
    return { beats, timing: end.timing, origin: clock.origin, start: clock.started, end: end.at };
  }
  let captured;
  try {
    if (!orderedPreview) {
      const baseline = await rehearse();
      await writeFile(join(directory, "runtime-baseline.json"), JSON.stringify({
        ...baseline, summary: runtimeStats(baseline.timing, baseline.start, baseline.end),
      }, null, 2));
    }
    // Lower the capture resolution and defer JPEG decoding and disk writes until
    // the measured interval ends so those tasks cannot delay a DevTools ack.
    await client.send("Page.startScreencast", { format: "jpeg", quality: 84, maxWidth: 1280, maxHeight: 820, everyNthFrame: 1 });
    captured = orderedPreview ? await playGatePreview(page, signal, scene) : await rehearse();
    cues.push(...captured.beats);
  } finally {
    await client.send("Page.stopScreencast").catch(() => {});
    client.off("Page.screencastFrame", receive);
    await client.detach();
  }
  if (comparePacing) {
    pacing.push(pacingWindow("same sequence during CDP capture", true, captured));
    const settled = await playGatePreview(page, signal, scene);
    pacing.push(pacingWindow("same sequence after capture", false, settled));
    await writeFile(join(directory, "runtime-pacing-comparison.json"), JSON.stringify({ scene, windows: pacing }, null, 2));
  }
  const started = captured.origin + captured.start;
  const ended = captured.origin + captured.end;
  const source = frames.filter(frame => frame.at >= started && frame.at <= ended);
  assert.ok(source.length > 100, "Continuous Piora screencast needs changing canvas frames");
  const duration = source.at(-1).at - source[0].at;
  assert.ok(duration >= 10_000 && duration <= 15_000, "The source recording must be 10–15 seconds");
  for (let index = 0; index < frames.length; index++) {
    await writeFile(join(folder, frames[index].filename), Buffer.from(payloads[index], "base64"));
  }
  const summary = {
    captureIntervalsMs: stats(gaps(source.map(frame => frame.at))),
    receiverIntervalsMs: stats(gaps(source.map(frame => frame.receivedAt))),
    ...runtimeStats(captured.timing, captured.start, captured.end),
  };
  await writeFile(join(directory, "runtime-during-capture.json"), JSON.stringify({ ...captured, summary }, null, 2));
  const gate = captured.observed && proveGatePreview(captured.observed, source, cues, scene);
  await writeFile(join(folder, "timing.json"), JSON.stringify({ started, ended, cues, frames: source, summary, gate }, null, 2));
}
