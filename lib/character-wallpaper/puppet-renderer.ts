import type { PuppetFrame } from "./puppet-director";
import { PARTS, puppetCover, puppetSurfaceSize, type Point, type PuppetRig, type Rect, type SpriteGroup } from "./puppet-rig.ts";
import { createPuppetSkeleton, IDENTITY_MATRIX } from "./puppet-skeleton.ts";
import { ARM_VERTEX_STRIDE, armFingerRounding, armGripPoint, createArmMesh } from "./puppet-arm-mesh.ts";
import { AUTUMN_AMBIENT, LAMP_AMBIENT } from "./puppet-ambient.ts";

const SPRITE_VERTEX = `
precision FLOAT_PRECISION float;
attribute vec2 aUnit;
uniform vec4 uRect;
uniform vec4 uCover;
uniform mat3 uBone;
uniform vec3 uFlex;
varying vec2 vUnit;
varying vec2 vStage;
void main() {
  vUnit = aUnit;
  vStage = uRect.xy + aUnit * uRect.zw;
  vec2 moving = (uBone * vec3(vStage, 1.0)).xy;
  float influence = 1.0 - uFlex.z * smoothstep(0.58, 1.0, aUnit.y);
  vec2 sway = uFlex.xy * sin(aUnit.y * 3.14159);
  gl_Position = vec4(mix(vStage, moving + sway, influence) * uCover.xy + uCover.zw, 0.0, 1.0);
}`;

const SPRITE_FRAGMENT = `
precision FLOAT_PRECISION float;
uniform sampler2D uTexture;
uniform vec4 uFrames[FRAME_COUNT];
uniform float uWeights[FRAME_COUNT];
uniform float uOpacity;
uniform vec4 uRect;
uniform vec2 uEyeL;
uniform vec2 uEyeR;
uniform vec2 uGaze;
varying vec2 vUnit;
varying vec2 vStage;
void main() {
  vec2 stretch = vec2(16.0, 9.0);
  float radius = min(length((vStage - uEyeL) / stretch), length((vStage - uEyeR) / stretch));
  vec2 local = clamp(vUnit - uGaze / uRect.zw * (1.0 - smoothstep(0.0, 1.0, radius)), 0.0, 1.0);
  vec4 color = vec4(0.0);
  for (int i = 0; i < FRAME_COUNT; i++) {
    if (uWeights[i] > 0.0001) {
      color += texture2D(uTexture, uFrames[i].xy + local * uFrames[i].zw) * uWeights[i];
    }
  }
  gl_FragColor = color * uOpacity;
}`;

const ARM_VERTEX = `
precision FLOAT_PRECISION float;
attribute vec2 aUnit;
attribute vec2 aJoint;
attribute vec2 aSample0;
attribute vec2 aSample1;
attribute vec2 aSample2;
attribute vec2 aSample3;
uniform vec4 uCover;
uniform mat3 uBone;
uniform mat3 uTorso;
uniform vec2 uWrist;
varying vec2 vSample0;
varying vec2 vSample1;
varying vec2 vSample2;
varying vec2 vSample3;
varying float vSection;
void main() {
  vSample0 = aSample0;
  vSample1 = aSample1;
  vSample2 = aSample2;
  vSample3 = aSample3;
  vSection = aJoint.y;
  vec3 stage = vec3(aUnit, 1.0);
  vec2 p = mix((uTorso * stage).xy, (uBone * stage).xy, aJoint.x);
  p += uWrist * smoothstep(3.8, 6.4, aJoint.y);
  gl_Position = vec4(p * uCover.xy + uCover.zw, 0.0, 1.0);
}`;

const ARM_FRAGMENT = `
precision FLOAT_PRECISION float;
uniform sampler2D uTexture;
uniform vec4 uFrames[4];
uniform vec4 uWeights;
uniform float uDistanceRange;
uniform float uFingerRounding;
varying vec2 vSample0;
varying vec2 vSample1;
varying vec2 vSample2;
varying vec2 vSample3;
varying float vSection;
vec4 cel(vec2 position, vec4 atlas) {
  if (position.x < 0.0 || position.y < 0.0 || position.x > 1.0 || position.y > 1.0) return vec4(0.0);
  return texture2D(uTexture, atlas.xy + position * atlas.zw);
}
void main() {
  vec4 a = uWeights.x > 0.0001 ? cel(vSample0, uFrames[0]) : vec4(0.0);
  vec4 b = uWeights.y > 0.0001 ? cel(vSample1, uFrames[1]) : vec4(0.0);
  vec4 c = uWeights.z > 0.0001 ? cel(vSample2, uFrames[2]) : vec4(0.0);
  vec4 d = uWeights.w > 0.0001 ? cel(vSample3, uFrames[3]) : vec4(0.0);
  // One boundary comes from the blended signed distance. Alpha blending
  // the painted cels themselves would show the room through a moving arm.
  vec4 distances = (vec4(a.a, b.a, c.a, d.a) * 2.0 - 1.0) * uDistanceRange;
  // Round transitions at the fingertips only so curled and open outlines
  // meet at the finger roots. The authored endpoints keep their own edges.
  float rounding = uFingerRounding * smoothstep(6.4, 8.0, vSection);
  float alpha = smoothstep(-0.85, 0.85, dot(distances, uWeights) + rounding);
  vec4 ink = uWeights * smoothstep(vec4(-9.0), vec4(2.0), distances);
  vec4 weight = ink / max(vec4(a.a, b.a, c.a, d.a), vec4(1.0 / 255.0));
  vec3 color = (a.rgb * weight.x + b.rgb * weight.y + c.rgb * weight.z + d.rgb * weight.w)
    / max(dot(ink, vec4(1.0)), 0.0001);
  gl_FragColor = vec4(color * alpha, alpha);
}`;

const AMBIENT_VERTEX = `
precision FLOAT_PRECISION float;
attribute vec2 aUnit;
uniform float uLeft;
varying vec2 vUnit;
void main() {
  vUnit = aUnit;
  gl_Position = vec4(mix(uLeft, 1.0, aUnit.x) * 2.0 - 1.0, 1.0 - aUnit.y * 2.0, 0.0, 1.0);
}`;

const AMBIENT_FRAGMENT = `
precision FLOAT_PRECISION float;
uniform float uTime;
uniform vec2 uExtent;
varying vec2 vUnit;
void main() {
  float ray = max(0.0, 1.0 - abs(vUnit.x - 0.27 - vUnit.y * 0.19) * 4.1);
  float alpha = ray * ray * (0.007 + 0.009 * sin(uTime * 0.61) * sin(uTime * 0.61));
  for (int i = 0; i < 7; i++) {
    float seed = float(i);
    float y = 1.0 - fract(seed * 0.2356 + uTime * (0.011 + seed * 0.0017));
    vec2 center = vec2(0.16 + 0.76 * fract(seed * 0.6180) + 0.046 * sin(uTime * 0.7 + seed), y);
    float distanceFromCenter = length((vUnit - center) * uExtent);
    float edge = smoothstep(0.0, 0.14, y) * (1.0 - smoothstep(0.78, 1.0, y));
    alpha += (1.0 - smoothstep(0.65, 2.9, distanceFromCenter)) * edge * (0.27 + seed * 0.024);
  }
  alpha *= smoothstep(0.0, 0.096, vUnit.x);
  gl_FragColor = vec4(vec3(1.0, 0.78, 0.44) * alpha, alpha);
}`;

type Texture = { handle: WebGLTexture; width: number; height: number };
type Mesh = { handle: WebGLBuffer; vertices: number };
type SpriteProgram = ReturnType<typeof spriteProgram>;

function shader(gl: WebGLRenderingContext, kind: number, source: string) {
  const handle = gl.createShader(kind);
  if (!handle) throw new Error("Unable to allocate puppet shader");
  gl.shaderSource(handle, source);
  gl.compileShader(handle);
  if (gl.getShaderParameter(handle, gl.COMPILE_STATUS)) return handle;
  const detail = gl.getShaderInfoLog(handle);
  gl.deleteShader(handle);
  throw new Error(detail ?? "Unable to compile puppet shader");
}

function spriteProgram(gl: WebGLRenderingContext, program: WebGLProgram) {
  const location = (name: string) => gl.getUniformLocation(program, name);
  return {
    program, unit: gl.getAttribLocation(program, "aUnit"),
    rect: location("uRect"), cover: location("uCover"), bone: location("uBone"), flex: location("uFlex"),
    frames: location("uFrames[0]"), weights: location("uWeights[0]"), opacity: location("uOpacity"),
    eyeL: location("uEyeL"), eyeR: location("uEyeR"), gaze: location("uGaze"),
  };
}

function grid(columns: number, rows: number) {
  const vertices: number[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const l = x / columns, r = (x + 1) / columns, t = y / rows, b = (y + 1) / rows;
      vertices.push(l, t, r, t, l, b, l, b, r, t, r, b);
    }
  }
  return new Float32Array(vertices);
}

export function createPuppetRenderer(canvas: HTMLCanvasElement, rig: PuppetRig, images: {
  stage: HTMLImageElement; parts: HTMLImageElement; face: HTMLImageElement;
}) {
  const gl = canvas.getContext("webgl", {
    alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
    powerPreference: "low-power",
  });
  if (!gl || gl.isContextLost()) throw new Error("WebGL 1.0 is unavailable");
  const context = gl;
  const programs: WebGLProgram[] = [];
  const buffers: WebGLBuffer[] = [];
  const textures: WebGLTexture[] = [];

  function dispose(releaseContext = false) {
    if (!context.isContextLost()) {
      context.bindTexture(context.TEXTURE_2D, null);
      context.bindBuffer(context.ARRAY_BUFFER, null);
      context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, null);
      context.useProgram(null);
    }
    for (const handle of textures.splice(0)) context.deleteTexture(handle);
    for (const handle of buffers.splice(0)) context.deleteBuffer(handle);
    for (const handle of programs.splice(0)) context.deleteProgram(handle);
    if (releaseContext && !context.isContextLost()) context.getExtension("WEBGL_lose_context")?.loseContext();
  }

  const precision = context.getShaderPrecisionFormat(context.FRAGMENT_SHADER, context.HIGH_FLOAT)?.precision ? "highp" : "mediump";

  function link(vs: string, fs: string) {
    const handle = context.createProgram();
    if (!handle) throw new Error("Unable to allocate puppet program");
    programs.push(handle);
    const vertex = shader(context, context.VERTEX_SHADER, vs.replace("FLOAT_PRECISION", precision));
    try {
      const fragment = shader(context, context.FRAGMENT_SHADER, fs.replace("FLOAT_PRECISION", precision));
      try {
        context.attachShader(handle, vertex);
        context.attachShader(handle, fragment);
        context.linkProgram(handle);
        if (!context.getProgramParameter(handle, context.LINK_STATUS)) throw new Error(context.getProgramInfoLog(handle) ?? "Unable to link puppet program");
        return handle;
      } finally {
        context.deleteShader(fragment);
      }
    } finally {
      context.deleteShader(vertex);
    }
  }

  function upload(image: HTMLImageElement): Texture {
    const width = image.naturalWidth, height = image.naturalHeight;
    const maxSize: number = context.getParameter(context.MAX_TEXTURE_SIZE);
    if (width > maxSize || height > maxSize) throw new Error("Puppet atlas is too large for WebGL");
    const handle = context.createTexture();
    if (!handle) throw new Error("Unable to allocate puppet texture");
    textures.push(handle);
    context.bindTexture(context.TEXTURE_2D, handle);
    // Interpolate and blend in premultiplied alpha to avoid dark/white seams.
    context.pixelStorei(context.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
    context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, context.RGBA, context.UNSIGNED_BYTE, image);
    if (context.getError() !== context.NO_ERROR) throw new Error("Unable to upload puppet texture");
    return { handle, width, height };
  }

  function allocateBuffer() {
    const handle = context.createBuffer();
    if (!handle) throw new Error("Unable to allocate puppet mesh");
    buffers.push(handle);
    return handle;
  }

  function mesh(columns: number, rows: number): Mesh {
    const handle = allocateBuffer();
    const positions = grid(columns, rows);
    context.bindBuffer(context.ARRAY_BUFFER, handle);
    context.bufferData(context.ARRAY_BUFFER, positions, context.STATIC_DRAW);
    return { handle, vertices: positions.length / 2 };
  }

  try {
    const single = spriteProgram(context, link(SPRITE_VERTEX, SPRITE_FRAGMENT.replaceAll("FRAME_COUNT", "1")));
    const action = spriteProgram(context, link(ARM_VERTEX, ARM_FRAGMENT));
    const expression = spriteProgram(context, link(SPRITE_VERTEX, SPRITE_FRAGMENT.replaceAll("FRAME_COUNT", "6")));
    const faceArea = spriteProgram(context, link(SPRITE_VERTEX, SPRITE_FRAGMENT.replaceAll("FRAME_COUNT", "3")));
    const ambientSource = rig.scene === "lamp" ? LAMP_AMBIENT : rig.scene === "autumn" ? AUTUMN_AMBIENT : AMBIENT_FRAGMENT;
    const ambient = link(AMBIENT_VERTEX, ambientSource);
    const ambientUnit = context.getAttribLocation(ambient, "aUnit");
    const ambientLeft = context.getUniformLocation(ambient, "uLeft");
    const ambientExtent = context.getUniformLocation(ambient, "uExtent");
    const ambientTime = context.getUniformLocation(ambient, "uTime");
    const ambientLamp = context.getUniformLocation(ambient, "uLamp");
    const ambientGlow = context.getUniformLocation(ambient, "uGlow");
    const stage = upload(images.stage), parts = upload(images.parts), face = upload(images.face);
    const quad = mesh(1, 1), flexible = mesh(3, 4);
    const arm = createArmMesh(rig.hands.rect, rig.armMesh);
    const armVertices = allocateBuffer(), armTriangles = allocateBuffer();
    const armAttributes = [
      { location: action.unit, size: 2, offset: 0 },
      { location: context.getAttribLocation(action.program, "aJoint"), size: 2, offset: 2 },
      ...[0, 1, 2, 3].map(i => ({ location: context.getAttribLocation(action.program, "aSample" + i), size: 2, offset: 4 + i * 2 })),
    ];
    const armWeights = context.getUniformLocation(action.program, "uWeights");
    const armTorso = context.getUniformLocation(action.program, "uTorso");
    const armWrist = context.getUniformLocation(action.program, "uWrist");
    const armDistanceRange = context.getUniformLocation(action.program, "uDistanceRange");
    const armRounding = context.getUniformLocation(action.program, "uFingerRounding");
    context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, armTriangles);
    context.bufferData(context.ELEMENT_ARRAY_BUFFER, arm.indices, context.STATIC_DRAW);
    const stageRect: Rect = [0, 0, ...rig.stage];
    const cover = new Float32Array(4);
    const skeleton = createPuppetSkeleton(rig);
    const maxViewport: Int32Array = context.getParameter(context.MAX_VIEWPORT_DIMS);
    const solid = new Float32Array([1]);
    const still: Point = [0, 0];
    let cssWidth = 0, cssHeight = 0;
    let lampX = 0, lampY = 0;

    function uv(texture: Texture, rects: Rect[]) {
      return Float32Array.from(rects.flatMap(([x, y, w, h]) => [
        x / texture.width, y / texture.height, w / texture.width, h / texture.height,
      ]));
    }

    const stageUV = uv(stage, [stageRect]);
    const partUV = Object.fromEntries(PARTS.map((name) => [name, uv(parts, [rig.parts[name].atlas])]));
    const handsUV = uv(parts, rig.hands.frames);
    const capeJoinUV = uv(parts, [rig.armCape.atlas]);
    const inkPenUV = rig.inkPen && uv(parts, [rig.inkPen.sprite.atlas]);
    const inkPenMatrix = IDENTITY_MATRIX.slice();
    const expressionsUV = uv(face, rig.expressions.frames);
    const blinksUV = uv(face, rig.blinks.frames);
    const mouthsUV = uv(face, rig.mouths.frames);

    function geometry(unit: number, surface: Mesh) {
      context.bindBuffer(context.ARRAY_BUFFER, surface.handle);
      context.enableVertexAttribArray(unit);
      context.vertexAttribPointer(unit, 2, context.FLOAT, false, 0, 0);
    }

    function sprite(program: SpriteProgram, texture: Texture, surface: Mesh, rect: Rect, frames: Float32Array,
      weights: Float32Array, matrix: Float32Array, opacity: number, dx = 0, dy = 0, anchor = 0, gaze = still) {
      context.useProgram(program.program);
      geometry(program.unit, surface);
      context.bindTexture(context.TEXTURE_2D, texture.handle);
      context.uniform4f(program.rect, ...rect);
      context.uniform4fv(program.cover, cover);
      context.uniformMatrix3fv(program.bone, false, matrix);
      context.uniform3f(program.flex, dx, dy, anchor);
      context.uniform4fv(program.frames, frames);
      context.uniform1fv(program.weights, weights);
      context.uniform1f(program.opacity, opacity);
      context.uniform2f(program.eyeL, ...rig.eyes[0]);
      context.uniform2f(program.eyeR, ...rig.eyes[1]);
      context.uniform2f(program.gaze, ...gaze);
      context.drawArrays(context.TRIANGLES, 0, surface.vertices);
    }

    function drawArm(frame: PuppetFrame, matrix: Float32Array, torso: Float32Array) {
      context.useProgram(action.program);
      context.bindBuffer(context.ARRAY_BUFFER, armVertices);
      if (arm.update(frame.hand)) context.bufferData(context.ARRAY_BUFFER, arm.vertices, context.DYNAMIC_DRAW);
      context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, armTriangles);
      for (const { location, size, offset } of armAttributes) {
        context.enableVertexAttribArray(location);
        context.vertexAttribPointer(location, size, context.FLOAT, false, ARM_VERTEX_STRIDE * 4, offset * 4);
      }
      context.bindTexture(context.TEXTURE_2D, parts.handle);
      context.uniform4fv(action.cover, cover);
      context.uniformMatrix3fv(action.bone, false, matrix);
      context.uniformMatrix3fv(armTorso, false, torso);
      context.uniform2f(armWrist, frame.pose.wristX, frame.pose.wristY);
      context.uniform4fv(action.frames, handsUV);
      context.uniform4fv(armWeights, frame.hand);
      context.uniform1f(armDistanceRange, rig.armMesh.distanceRange);
      context.uniform1f(armRounding, armFingerRounding(frame.hand, rig.armMesh.fingerRoundingPx));
      context.drawElements(context.TRIANGLES, arm.indices.length, context.UNSIGNED_SHORT, 0);
      for (const { location } of armAttributes) context.disableVertexAttribArray(location);
    }

    return {
      resize(width: number, height: number, dpr: number) {
        cssWidth = width;
        cssHeight = height;
        const size = puppetSurfaceSize(width, height, dpr, maxViewport[0], maxViewport[1]);
        if (canvas.width !== size.width) canvas.width = size.width;
        if (canvas.height !== size.height) canvas.height = size.height;
        context.viewport(0, 0, size.width, size.height);
        const fit = puppetCover(width, height, rig.stage, rig.focusX);
        cover.set([fit.scale * 2 / width, -fit.scale * 2 / height, fit.left * 2 / width - 1, 1 - fit.top * 2 / height]);
        if (rig.lamp) {
          lampX = fit.left + rig.lamp.center[0] * fit.scale;
          lampY = fit.top + rig.lamp.center[1] * fit.scale;
        }
      },
      draw(frame: PuppetFrame, now: number, ambientStart: number) {
        if (!cssWidth || context.isContextLost()) return false;
        context.disable(context.BLEND);
        sprite(single, stage, quad, stageRect, stageUV, solid, IDENTITY_MATRIX, 1);
        context.enable(context.BLEND);
        context.blendFunc(context.ONE, context.ONE_MINUS_SRC_ALPHA);
        if (ambientStart < 1) {
          context.useProgram(ambient);
          geometry(ambientUnit, quad);
          context.uniform1f(ambientLeft, ambientStart);
          context.uniform2f(ambientExtent, cssWidth * (1 - ambientStart), cssHeight);
          context.uniform1f(ambientTime, now % 1000);
          if (rig.lamp) {
            context.uniform2f(ambientLamp, lampX - cssWidth * ambientStart, lampY);
            context.uniform1f(ambientGlow, frame.pose.glow);
          }
          context.drawArrays(context.TRIANGLES, 0, quad.vertices);
        }
        const matrices = skeleton(frame);
        const p = frame.pose;
        const eyes: Point = [p.gazeX * 1.65, p.gazeY * 0.92];
        const faceGroup = (group: SpriteGroup, program: SpriteProgram, frames: Float32Array, weights: Float32Array, opacity: number, gaze = still) =>
          sprite(program, face, quad, group.rect, frames, weights, matrices.head_base, opacity, 0, 0, 0, gaze);
        for (const name of PARTS) {
          const part = rig.parts[name];
          const flowing = name === "back_hair" || name === "cape_skirt" || name === "tassel_ribbon";
          const bend = name === "back_hair" ? p.backHair * 3.6 : name === "cape_skirt" ? p.lean * 0.33 : p.silk * 1.2;
          sprite(single, parts, flowing ? flexible : quad, part.rect, partUV[name], solid, matrices[name],
            name === "book_page" ? p.page : 1, flowing ? bend : 0, 0, name === "back_hair" ? 1 : 0);
          if (name === "head_base") {
            faceGroup(rig.expressions, expression, expressionsUV, frame.expression, 1, eyes);
            if (frame.blink[0] < 0.999) faceGroup(rig.blinks, faceArea, blinksUV, frame.blink, 1 - frame.blink[0], eyes);
            if (p.talk > 0.001) faceGroup(rig.mouths, faceArea, mouthsUV, frame.mouth, p.talk);
          }
        }
        if (rig.inkPen && inkPenUV) {
          const strength = frame.hand[0] + frame.hand[1];
          if (strength > 0.001) {
            const [hx, hy] = armGripPoint(rig.armMesh.stage, frame.hand, rig.inkPen.handGrip);
            const [x, y] = rig.inkPen.grip;
            const arm = matrices.arm_front;
            inkPenMatrix.set(arm);
            inkPenMatrix[6] += (hx - x) * arm[0] + (hy - y) * arm[3] + p.wristX;
            inkPenMatrix[7] += (hx - x) * arm[1] + (hy - y) * arm[4] + p.wristY;
            sprite(single, parts, quad, rig.inkPen.sprite.rect, inkPenUV, solid, inkPenMatrix, strength);
          }
        }
        drawArm(frame, matrices.arm_front, matrices.torso);
        sprite(single, parts, quad, rig.armCape.rect, capeJoinUV, solid, matrices.torso, 1);
        return true;
      },
      dispose,
    };
  } catch (error) {
    dispose(true);
    throw error;
  }
}

export type PuppetRenderer = ReturnType<typeof createPuppetRenderer>;
