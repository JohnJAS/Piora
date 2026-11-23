import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CHARACTER_STATES, createCharacterDirectorState, getCharacterSessionCue, getCharacterSessionPhase } from "../character-director-state.ts";
import { approach, createPuppetDirector, samplePageTurn, swing } from "./puppet-director.ts";
import { sampleVignette } from "./puppet-scenes.ts";
import { BONES, puppetCover, puppetSurfaceSize } from "./puppet-rig.ts";
import { createPuppetSkeleton } from "./puppet-skeleton.ts";
import { ARM_VERTEX_STRIDE, armFingerRounding, armGripPoint, createArmMesh } from "./puppet-arm-mesh.ts";

test("main conversation phases distinguish text streaming, tool calls, retries, and approvals", () => {
  const idle = { approval: false, retrying: false, tools: false, streamingText: false, busy: false };
  assert.equal(getCharacterSessionPhase(idle), "idle");
  assert.equal(getCharacterSessionPhase({ ...idle, busy: true }), "thinking");
  assert.equal(getCharacterSessionPhase({ ...idle, busy: true, streamingText: true }), "streaming");
  assert.equal(getCharacterSessionPhase({ ...idle, tools: true, streamingText: true }), "working_tools");
  assert.equal(getCharacterSessionPhase({ ...idle, retrying: true, tools: true }), "error");
  assert.equal(getCharacterSessionPhase({ ...idle, approval: true, retrying: true, tools: true }), "waiting_approval");
});

test("a displayed failed assistant reply settles as an error after its notice disappears", () => {
  const source = Symbol();
  const director = createCharacterDirectorState(() => 3000);
  director.session(source, "thinking", getCharacterSessionCue("run", "started"));
  director.session(source, "idle", getCharacterSessionCue("done", "completed", "error"));
  assert.equal(director.state(), "error");
  assert.equal(getCharacterSessionCue("done", "poke", "error"), undefined);
});

test("composer throttle, one-shot completion, cancellation, wake and click cooldown", () => {
  let now = 0;
  const state = createCharacterDirectorState(() => now);
  const main = Symbol(), other = Symbol();
  const set = (phase, cue, cancelled) => state.session(main, phase, cue, cancelled);
  set("idle");
  assert.equal(state.state(), "idle");
  state.composer(main, "focus");
  assert.equal(state.state(), "user_typing");
  now = 249;
  state.composer(main, "input");
  now = 1_201;
  assert.equal(state.state(), "idle");
  state.composer(main, "input");
  set("thinking");
  assert.equal(state.state(), "thinking");
  state.composer(main, "input");
  set("waiting_approval");
  assert.equal(state.state(), "waiting_approval");
  set("working_tools");
  assert.equal(state.state(), "working_tools");
  set("streaming");
  assert.equal(state.state(), "streaming");
  const completion = { kind: "completed", key: "prompt1" };
  set("idle", completion);
  assert.equal(state.state(), "success");
  now += 3_499;
  set("idle", completion);
  assert.equal(state.state(), "success");
  now++;
  assert.equal(state.state(), "idle");
  set("thinking", { kind: "started", key: "prompt2" });
  set("idle", { kind: "completed", key: "cancelled" }, true);
  assert.equal(state.state(), "idle");
  set("error");
  set("idle", { kind: "failed", key: "failed" });
  assert.equal(state.state(), "error");
  set("thinking", { kind: "started", key: "prompt3" });
  assert.equal(state.state(), "thinking");
  state.release(other);
  assert.equal(state.state(), "thinking");
  set("idle");
  now += 10 * 60_000;
  assert.equal(state.state(), "sleepy");
  state.interact();
  assert.equal(state.state(), "idle");
  now += 10 * 60_000;
  assert.equal(state.greet(), true);
  assert.equal(state.state(), "greet");
  now += 4_999;
  assert.equal(state.greet(), false);
  assert.equal(state.state(), "idle");
  now++;
  assert.equal(state.greet(), true);
  now += 2_201;
  state.composer(main, "input");
  assert.equal(state.state(), "user_typing");
  state.composer(main, "blur");
  assert.equal(state.state(), "idle");
  state.release(main);
  state.composer(main, "input");
  assert.equal(state.state(), "idle");
});

test("retargeted motion preserves position and velocity and the page-turn beats have smooth tangents", () => {
  const channel = { value: 0, intermediate: 0 };
  approach(channel, 9, 0.17, 10);
  const previous = { ...channel };
  const a = approach(channel, -7, 0.00001, 10);
  const b = approach(previous, 9, 0.00001, 10);
  assert.ok(Math.abs(a - b) < 1e-6);
  for (const boundary of [0.56, 1.1, 1.55, 1.87, 2.4, 2.92, 3.6]) {
    const center = samplePageTurn(boundary);
    for (const delta of [-0.00001, 0.00001]) {
      const nearby = samplePageTurn(boundary + delta);
      for (const property of ["head", "reach", "page", "smile"]) {
        assert.ok(Math.abs(center[property] - nearby[property]) / Math.abs(delta) < 0.01);
      }
    }
  }
  const hair = { value: 0, velocity: 0 };
  swing(hair, 4, 0.1, 15);
  assert.ok(hair.value > 0 && hair.value < 4 && hair.velocity > 0);
  const prior = hair.value;
  swing(hair, 0, 0.01, 15);
  assert.ok(hair.value > prior, "Secondary motion retains momentum as its target reverses");
});

test("all state changes keep nonnegative blended frame weights and story/voice are independent", () => {
  const director = createPuppetDirector(() => 0.3);
  director.playPageTurn();
  let visibleLift = 0;
  for (let index = 0; index < 55; index++) {
    const frame = director.step(1 / 30, "idle");
    assert.equal(frame.mouth[0], 1);
    visibleLift = Math.max(visibleLift, frame.pose.page);
  }
  assert.ok(visibleLift > 0.9);
  for (const state of CHARACTER_STATES) {
    const frame = director.step(1 / 30, state);
    for (const weights of [frame.hand, frame.expression, frame.blink, frame.mouth]) {
      assert.ok(weights.every(weight => weight >= 0 && weight <= 1));
      assert.ok(Math.abs(weights.reduce((sum, weight) => sum + weight) - 1) < 1e-6);
    }
  }
  let speaking = false;
  for (let index = 0; index < 36; index++) {
    const frame = director.step(1 / 30, "streaming");
    speaking ||= frame.mouth[2] > 0.4;
  }
  assert.ok(speaking);
  for (let index = 0; index < 60; index++) director.step(1 / 30, "idle");
  assert.ok(director.step(0, "idle").mouth[0] > 0.999);
});

test("the night-reading vignette lights the lamp, lifts the book, scans it, and smiles after it is set down", () => {
  const at = seconds => sampleVignette("lamp", seconds).motion;
  assert.ok(at(0.6).glow > 0.9 && at(0.6).carry === 0);
  assert.equal(at(1.47).carry, 1);
  assert.ok(at(2.05).gazeX > 0.7 && at(2.8).gazeX < -0.4);
  assert.equal(at(2.8).carry, 1);
  assert.ok(at(4.11).carry === 0 && at(4.11).smile === 1);
});

test("the autumn vignette eases from chin rest through handwriting and a page lift before looking up", () => {
  const at = seconds => sampleVignette("autumn", seconds).motion;
  assert.ok(at(0.69).chin === 1 && at(0.69).gazeY < 0);
  assert.ok(at(2).write > 0.9 && at(2).gazeY > 0.6);
  assert.ok(at(2.99).page === 1 && at(2.99).write === 0);
  assert.ok(at(4.08).smile === 1 && at(4.08).head > 0);
  for (const [scene, join] of [["lamp", 1.47], ["autumn", 1.97]]) {
    const edge = sampleVignette(scene, join).motion;
    for (const near of [join - 0.0001, join + 0.0001]) {
      const arm = sampleVignette(scene, near).motion;
      assert.ok(Math.abs(arm.reach - edge.reach) < 1e-6);
      assert.ok(Math.abs(arm.head - edge.head) < 1e-5);
    }
  }
});

test("both scene directors reset idle motions while keeping all ten state channels finite through interruptions", () => {
  for (const scene of ["lamp", "autumn"]) {
    const director = createPuppetDirector(() => 0.5, scene);
    director.playPageTurn();
    const phases = [[120, "idle"], ...CHARACTER_STATES.map(state => [37, state]), [180, "idle"]];
    for (const [count, state] of phases) {
      for (let i = 0; i < count; i++) {
        const frame = director.step(1 / 30, state);
        for (const value of Object.values(frame.pose)) {
          if (typeof value === "number") assert.ok(Number.isFinite(value));
        }
        for (const group of [frame.hand, frame.expression, frame.blink, frame.mouth]) {
          assert.ok(group.every(weight => weight >= 0 && weight <= 1));
          assert.ok(Math.abs(group.reduce((sum, weight) => sum + weight) - 1) < 1e-6);
        }
      }
    }
    const { pose, mouth, hand } = director.step(1 / 30, "idle");
    assert.ok(!pose.storyRunning && pose.bookCarry === 0 && pose.glow === 0);
    assert.ok(Math.abs(pose.wristX) < 0.001 && mouth[0] > 0.999 && hand[0] > 0.999);
  }
});

test("a lamp grip follows the same moving arm triangles and carries the page and book together", () => {
  const path = new URL("../../public/themes/character-backgrounds/claude-live/claude-paper/rig.json", import.meta.url);
  // Exercise the shared transform independently of the calibrated lamp artwork.
  const rig = JSON.parse(readFileSync(path, "utf8"));
  rig.lamp = { center: [1584, 280], bookGrip: [1039, 414], handGrip: [6.2, 0.49] };
  const director = createPuppetDirector(() => 0.5, "lamp");
  director.playPageTurn();
  let frame;
  for (let i = 0; i < 70; i++) frame = director.step(1 / 30, "idle");
  assert.ok(frame.pose.bookCarry > 0.99999);
  const moving = createPuppetSkeleton(rig)(frame);
  const uncarried = createPuppetSkeleton({ ...rig, lamp: undefined })(frame);
  const transform = (matrix, [x, y]) => [
    matrix[0] * x + matrix[3] * y + matrix[6],
    matrix[1] * x + matrix[4] * y + matrix[7],
  ];
  const grip = armGripPoint(rig.armMesh.stage, frame.hand, rig.lamp.handGrip);
  const [handX, handY] = transform(moving.arm_front, grip);
  const [bookX, bookY] = transform(moving.prop, rig.lamp.bookGrip);
  assert.ok(Math.hypot(handX - bookX, handY - bookY) < 0.0001);
  for (const index of [6, 7]) {
    assert.ok(Math.abs(moving.prop[index] - uncarried.prop[index]
      - (moving.book_page[index] - uncarried.book_page[index])) < 0.0001);
  }
});

test("child pivots inherit the parent transform and the visible crop matches 80% cover", () => {
  const bones = Object.fromEntries(BONES.map(name => [name, { pivot: [0, 0], parent: null, depth: 0 }]));
  bones.head_base = { pivot: [100, 40], parent: "torso", depth: 0.5 };
  bones.front_hair_l = { pivot: [120, 55], parent: "head_base", depth: 0.5 };
  const director = createPuppetDirector(() => 0.3);
  const step = createPuppetSkeleton({ bones });
  const frame = director.step(0.6, "user_typing");
  const matrices = step(frame);
  const transform = (matrix, x, y) => [
    matrix[0] * x + matrix[3] * y + matrix[6],
    matrix[1] * x + matrix[4] * y + matrix[7],
  ];
  const child = transform(matrices.front_hair_l, 120, 55);
  const parent = transform(matrices.head_base, 120, 55);
  assert.ok(Math.hypot(child[0] - parent[0], child[1] - parent[1]) < 1e-4);
  assert.deepEqual(puppetCover(1452, 941, [1672, 941], 0.8), { scale: 1, left: -176, top: 0 });
  for (const [width, height] of [[800, 600], [3000, 1800], [390, 844]]) {
    const target = puppetSurfaceSize(width, height, 3, 16_384, 16_384);
    assert.ok(target.width * target.height <= 1_600_000);
    assert.ok(target.width / width <= 1.5 && target.height / height <= 1.5);
  }
});

for (const scene of ["paper", "lamp", "autumn"]) test(`${scene} shoulder seams stay pinned through strand and arm motion`, () => {
  const path = new URL(`../../public/themes/character-backgrounds/claude-live/claude-${scene}/rig.json`, import.meta.url);
  const rig = JSON.parse(readFileSync(path, "utf8"));
  const [left, top, width, height] = rig.hands.rect;
  const mesh = createArmMesh(rig.hands.rect, rig.armMesh);
  const posed = createPuppetSkeleton(rig);
  const director = createPuppetDirector(() => 0.95, scene);
  const states = ["idle", "working_tools", "thinking", "greet"];
  const savedUV = Array.from(mesh.vertices).filter((_, index) => index % ARM_VERTEX_STRIDE >= 4);
  const shoulder = rig.armMesh.stage[0].slice(0, 2);
  function verify(frame) {
    mesh.update(frame.hand);
    const bones = posed(frame);
    const transform = (matrix, x, y) => [matrix[0] * x + matrix[3] * y + matrix[6], matrix[1] * x + matrix[4] * y + matrix[7]];
    function point(index) {
      const at = index * ARM_VERTEX_STRIDE;
      const [x, y, arm, section] = mesh.vertices.slice(at, at + 4);
      const a = transform(bones.torso, x, y), b = transform(bones.arm_front, x, y);
      const t = Math.min(1, Math.max(0, (section - 3.8) / (6.4 - 3.8)));
      const wrist = t * t * (3 - 2 * t);
      return [
        a[0] + (b[0] - a[0]) * arm + frame.pose.wristX * wrist,
        a[1] + (b[1] - a[1]) * arm + frame.pose.wristY * wrist,
      ];
    }
    for (let index = 0; index < 2; index++) {
      const offset = index * ARM_VERTEX_STRIDE;
      assert.equal(mesh.vertices[offset + 2], 0);
      assert.ok(Math.hypot(mesh.vertices[offset] - shoulder[index][0], mesh.vertices[offset + 1] - shoulder[index][1]) < 0.001);
    }
    for (let offset = 0; offset < mesh.indices.length; offset += 3) {
      const [[ax, ay], [bx, by], [cx, cy]] = Array.from(mesh.indices.slice(offset, offset + 3), point);
      assert.ok((bx - ax) * (cy - ay) - (by - ay) * (cx - ax) > 0, "the joined arm remains front-facing");
    }
  }
  for (const from of states) {
    for (const to of states) {
      if (from === to) continue;
      for (let index = 0; index < 30; index++) director.step(1 / 30, from);
      for (let index = 0; index < 30; index++) verify(director.step(1 / 30, to));
    }
  }
  for (let index = 0; index < 60; index++) verify(director.step(1 / 30, states[Math.floor(index / 3) % states.length]));
  director.playPageTurn();
  for (let index = 0; index < 160; index++) verify(director.step(1 / 30, "idle"));
  assert.deepEqual(Array.from(mesh.vertices).filter((_, index) => index % ARM_VERTEX_STRIDE >= 4), savedUV);
  for (const [pose, points] of rig.armMesh.source.entries()) {
    for (const [point, [x, y]] of points.entries()) {
      const offset = point * ARM_VERTEX_STRIDE + 4 + pose * 2;
      assert.ok(Math.abs(mesh.vertices[offset] - (x - left) / width) < 1e-6);
      assert.ok(Math.abs(mesh.vertices[offset + 1] - (y - top) / height) < 1e-6);
    }
    assert.equal(armFingerRounding(Float32Array.from(states, (_, i) => Number(i === pose)), rig.armMesh.fingerRoundingPx), 0);
  }
});
