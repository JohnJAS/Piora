import { createCharacterMesh } from "./character-wallpaper-mesh";
import { gestureAt, partBounds, type CharacterPerformance } from "./character-wallpaper-parts";
export { getCharacterPerformance } from "./character-wallpaper-parts";
import type { CharacterWallpaperRig, Region } from "./character-wallpaper-rigs";

const VERTEX_SOURCE = `
  attribute vec2 a_position;
  attribute vec4 a_weights; // head, chest, loose material A and B
  uniform vec2 u_viewCenter;
  uniform vec2 u_coverSize;
  uniform vec2 u_headPivot;
  uniform vec2 u_turn;
  uniform vec2 u_lift;
  uniform vec2 u_lean;
  uniform vec2 u_sway;
  uniform vec4 u_roots;
  uniform vec4 u_release; // cheek contact and the transient head lift away from a moving hand
  uniform vec4 u_upperArm; // shoulder, segment radius, angle
  uniform vec2 u_elbow;
  varying highp vec2 v_artwork;
  varying highp vec2 v_posed;

  vec2 swing(vec2 root, float angle) {
    vec2 arm = a_position - root;
    // Tangential displacement about the fixed root, for a small-angle swing.
    return vec2(-arm.y, arm.x) * angle;
  }

  void main() {
    v_artwork = a_position;
    vec2 arm = a_position - u_headPivot;
    mat2 rotation = mat2(u_turn.x, u_turn.y, -u_turn.y, u_turn.x);
    vec2 point = a_position + a_weights.x * (rotation * arm - arm);
    point.y -= dot(a_weights.xy, u_lift);
    point.x += dot(a_weights.xy, u_lean);
    point += a_weights.z * swing(u_roots.xy, u_sway.x);
    point += a_weights.w * swing(u_roots.zw, u_sway.y);
    vec2 cheek = (a_position - u_release.xy) / vec2(80.0, 55.0);
    float support = 1.0 - smoothstep(0.25, 1.0, dot(cheek, cheek));
    point.y -= u_release.z * max(a_weights.x, support);
    if (u_upperArm.z > 0.0) {
      vec2 bone = u_elbow - u_upperArm.xy;
      vec2 lever = a_position - u_upperArm.xy;
      float t = clamp(dot(lever, bone) / dot(bone, bone), 0.0, 1.0);
      float skin = 1.0 - smoothstep(u_upperArm.z * 0.72, u_upperArm.z * 1.65, length(lever - t * bone));
      float c = cos(u_upperArm.w), s = sin(u_upperArm.w);
      point += skin * (mat2(c, s, -s, c) * lever - lever);
    }
    v_posed = point;
    gl_Position = vec4((point - u_viewCenter) / u_coverSize * vec2(2.0, -2.0), 0.0, 1.0);
  }
`;

const FRAGMENT_SOURCE = `
  precision highp float;
  varying highp vec2 v_artwork;
  varying highp vec2 v_posed;
  uniform sampler2D u_artwork;
  uniform vec2 u_imageSize;
  uniform vec4 u_eyeA;
  uniform vec4 u_eyeB;
  uniform vec4 u_eyeHeights;
  uniform float u_blink;
  uniform vec2 u_gaze;
  uniform sampler2D u_atlas;
  uniform vec2 u_atlasSize;
  uniform vec4 u_rect[3]; // source-space bounds, packed horizontally in the atlas
  uniform vec4 u_hinge[3]; // pivot, radius of the attached root, max tip travel
  uniform vec3 u_angles;
  uniform vec2 u_elbowOffset;
  uniform vec3 u_tether[3];

  vec3 artworkAt(vec2 point) {
    return texture2D(u_artwork, point / u_imageSize).rgb;
  }

  vec4 patchAt(vec2 point, vec4 rect, float atlasX) {
    vec2 local = point - rect.xy;
    if (any(lessThan(local, vec2(0.0))) || any(greaterThanEqual(local, rect.zw))) return vec4(0.0);
    return texture2D(u_atlas, (vec2(atlasX, 0.0) + local) / u_atlasSize);
  }

  // Invert the hinge rotation to sample the painted foreground with its
  // original proportions. Radius is invariant under rotation, including
  // through the small soft attachment at an elbow or the root of a wing.
  vec3 layerAt(vec3 under, vec2 point, vec4 rect, vec4 hinge, float angle, float atlasX, vec2 jointOffset, vec3 tether) {
    vec2 outside = max(rect.xy - point, point - (rect.xy + rect.zw));
    if (rect.z == 0.0 || max(outside.x, outside.y) > hinge.w || (abs(angle) < 0.00001 && dot(jointOffset,jointOffset)<0.00001)) return under;
    bool flexible = hinge.z > 0.0;
    // Bone-bound limbs move in scene coordinates. A hand crossing moving
    // hair must not stretch with the hair mesh behind it.
    vec2 arm = (flexible ? point : v_posed) - hinge.xy - jointOffset;
    if (tether.z > 0.0) angle *= smoothstep(0.0, tether.z, distance(v_posed, tether.xy));
    if (flexible) {
      // A wing or lock may continue beyond the original painting. Keep its
      // cropped edge outside the frame as the interior opens and folds.
      vec2 edge = min(point, u_imageSize - point);
      angle *= smoothstep(0.0, 54.0, min(edge.x, edge.y));
      arm.x /= 1.0 + 0.25 * sin(angle);
    }
    float a = -angle * smoothstep(0.0, abs(hinge.z), length(arm));
    float s = sin(a), c = cos(a);
    vec2 rest = hinge.xy + mat2(c, s, -s, c) * arm;
    vec4 back = patchAt(point, rect, atlasX);
    const float split = 64.0 / 255.0;
    float front = max(0.0, (patchAt(rest, rect, atlasX).a - split) / (1.0 - split));
    float oldFront = max(0.0, (back.a - split) / (1.0 - split));
    float erase = mix(oldFront, min(1.0, back.a / split), smoothstep(0.25, 2.5, distance(point, rest)));
    // Only expose the repair where the foreground actually vacates a pixel.
    float reveal = clamp((erase - front) / max(0.001, 1.0 - front), 0.0, 1.0);
    return mix(mix(under, back.rgb, reveal), artworkAt(rest), front);
  }

  // Lower the lids over the painted iris. Pixels still visible through the
  // opening keep their original shape and the highlight stays in place.
  vec3 blinkEye(vec3 color, vec2 point, vec4 corners, vec2 heights) {
    if (heights.x == 0.0) return color;
    vec2 chord = corners.zw - corners.xy;
    float width = length(chord);
    vec2 along = chord / width;
    vec2 down = vec2(-along.y, along.x);
    vec2 offset = point - corners.xy;
    float horizontal = dot(offset, along) / width;
    if (horizontal <= 0.0 || horizontal >= 1.0) return color;

    float arc = sqrt(4.0 * horizontal * (1.0 - horizontal));
    float upper = -heights.x * arc;
    float lower = heights.y * arc;
    float vertical = dot(offset, down);
    if (vertical <= upper - 4.5 || vertical >= lower + 5.0) return color;
    float sclera = smoothstep(upper + 0.6, upper + 3.0, vertical)
      * (1.0 - smoothstep(lower - 3.0, lower - 0.6, vertical))
      * smoothstep(0.03, 0.18, horizontal) * (1.0 - smoothstep(0.82, 0.97, horizontal));
    vec2 shift = along * (width * 0.085 * u_gaze.x) + down * (heights.y * 0.22 * u_gaze.y);
    color = mix(color, artworkAt(point - shift), sclera);
    if (u_blink <= 0.0) return color;

    vec2 center = (corners.xy + corners.zw) * 0.5;
    vec3 cheek = artworkAt(center + down * (heights.y + 8.0));
    vec3 skinAbove = artworkAt(center - down * (heights.x + 6.5));
    vec2 below = center + down * (heights.y + 5.0);
    vec3 skinLeft = artworkAt(below - chord * 0.22);
    vec3 skinRight = artworkAt(below + chord * 0.22);
    // Fade the influence of samples that cross a strand of hair or an eyebrow.
    skinAbove = mix(cheek, skinAbove, 1.0 - smoothstep(0.07, 0.19, distance(cheek, skinAbove)));
    skinLeft = mix(cheek, skinLeft, 1.0 - smoothstep(0.09, 0.24, distance(cheek, skinLeft)));
    skinRight = mix(cheek, skinRight, 1.0 - smoothstep(0.09, 0.24, distance(cheek, skinRight)));
    vec3 skinBelow = mix(skinLeft, skinRight, smoothstep(0.0, 1.0, horizontal));
    vec3 skin = mix(skinAbove, skinBelow, smoothstep(upper, lower, vertical));
    skin = mix(skin, color, (1.0 - smoothstep(0.045, 0.16, distance(skin, color))) * 0.8);

    float closed = mix(upper, lower, 0.62);
    float lidTop = mix(upper, closed - 0.4 * arc, u_blink);
    float lidBottom = mix(lower, closed + 0.4 * arc, u_blink);
    float aperture = smoothstep(lidTop - 0.7, lidTop + 0.5, vertical)
      * (1.0 - smoothstep(lidBottom - 0.5, lidBottom + 0.7, vertical))
      * (1.0 - smoothstep(0.83, 1.0, u_blink));
    float crease = 1.0 - smoothstep(0.0, 4.0 + 0.05 * width, abs(vertical - lidTop + 3.2 * arc));
    vec3 lid = mix(skin * (1.0 - 0.075 * arc * crease * u_blink), color, aperture);

    vec3 lash = artworkAt(center - down * (heights.x - 3.0));
    vec3 ink = mix(skin * 0.38, lash, 0.32);
    float stroke = arc * clamp(width * 0.028, 1.15, 2.25);
    float line = 1.0 - smoothstep(stroke * 0.45, stroke + 0.8, abs(vertical - lidTop));
    lid = mix(lid, ink, line * smoothstep(0.08, 0.8, u_blink));
    float feather = smoothstep(0.0, 0.075, horizontal) * (1.0 - smoothstep(0.925, 1.0, horizontal))
      * smoothstep(upper - 4.5, upper + 0.5, vertical)
      * (1.0 - smoothstep(lower - 0.5, lower + 5.0, vertical));
    return mix(color, lid, feather * smoothstep(0.0, 0.28, u_blink));
  }

  void main() {
    vec2 point = v_artwork;
    vec3 color = artworkAt(point);
    if (u_blink > 0.0 || dot(u_gaze, u_gaze) > 0.00001) {
      color = blinkEye(color, point, u_eyeA, u_eyeHeights.xy);
      color = blinkEye(color, point, u_eyeB, u_eyeHeights.zw);
    }
    color = layerAt(color, point, u_rect[0], u_hinge[0], u_angles.x, 0.0, u_elbowOffset, u_tether[0]);
    color = layerAt(color, point, u_rect[1], u_hinge[1], u_angles.y, u_rect[0].z, vec2(0.0), u_tether[1]);
    color = layerAt(color, point, u_rect[2], u_hinge[2], u_angles.z, u_rect[0].z + u_rect[1].z, vec2(0.0), u_tether[2]);
    gl_FragColor = vec4(color, 1.0);
  }
`;

const MAX_RENDER_PIXELS = 1_600_000;
const TAU = 2 * Math.PI;

function smoothstep(start: number, end: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

function blink(timeSinceStart: number): number {
  return smoothstep(0, 0.10, timeSinceStart) * (1 - smoothstep(0.15, 0.32, timeSinceStart));
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE);
  const program = vertex && fragment ? gl.createProgram() : null;
  if (program && vertex && fragment) {
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
  }
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (program && gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  gl.deleteProgram(program);
  return null;
}

export function createCharacterWallpaperRenderer(
  canvas: HTMLCanvasElement,
  artwork: HTMLImageElement,
  rig: CharacterWallpaperRig,
  layers?: { performance: CharacterPerformance; atlas: HTMLImageElement },
  view?: { focusX: number; maxPixels: number },
) {
  const context = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: "low-power",
  });
  if (!context) return null;
  const gl = context;
  const program = createProgram(gl);
  const vertices = gl.createBuffer();
  const elements = gl.createBuffer();
  const texture = gl.createTexture();
  const atlasTexture = gl.createTexture();
  function dispose() {
    gl.deleteTexture(texture);
    gl.deleteTexture(atlasTexture);
    gl.deleteBuffer(vertices);
    gl.deleteBuffer(elements);
    gl.deleteProgram(program);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
  if (!program || !vertices || !elements || !texture || !atlasTexture) {
    dispose();
    return null;
  }

  const width = artwork.naturalWidth;
  const height = artwork.naturalHeight;
  const { vertices: mesh, indices } = createCharacterMesh(width, height, rig);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
  gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(position);
  const stride = 6 * Float32Array.BYTES_PER_ELEMENT;
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, stride, 0);
  const weights = gl.getAttribLocation(program, "a_weights");
  gl.enableVertexAttribArray(weights);
  gl.vertexAttribPointer(weights, 4, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elements);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  const indexCount = indices.length;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  try {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, artwork);
  } catch {
    dispose();
    return null;
  }
  if (gl.getError() !== gl.NO_ERROR) {
    dispose();
    return null;
  }

  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const parts = layers?.performance.parts ?? [];
  const rects = new Float32Array(12);
  const hinges = new Float32Array(12);
  const tethers = new Float32Array(9);
  const angles = new Float32Array(3);
  for (const [i, part] of parts.entries()) {
    rects.set(partBounds(part), i * 4);
    const reach = Math.max(...part.outline.map(([x, y]) => Math.hypot(x - part.pivot[0], y - part.pivot[1])));
    const root = part.rigid ? -Math.max(8, reach * 0.14) : Math.max(8, reach * 0.90);
    const parentTravel = part.parent ? Math.hypot(part.pivot[0] - part.parent[0], part.pivot[1] - part.parent[1]) *
      Math.abs(part.parent[3]) * Math.PI / 180 : 0;
    hinges.set([...part.pivot, root, 3 + (parentTravel + reach *
      (Math.abs(part.angle) + Math.abs(part.parent?.[3] ?? 0)) * Math.PI / 180) * 1.8], i * 4);
    if (part.tether) tethers.set(part.tether, i * 3);
  }
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  try {
    if (layers) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layers.atlas);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    }
  } catch {
    dispose();
    return null;
  }
  if (gl.getError() !== gl.NO_ERROR) {
    dispose();
    return null;
  }
  gl.uniform1i(uniform("u_atlas"), 1);
  gl.uniform2f(uniform("u_atlasSize"), layers?.atlas.naturalWidth ?? 1, layers?.atlas.naturalHeight ?? 1);
  gl.uniform4fv(uniform("u_rect[0]"), rects);
  gl.uniform4fv(uniform("u_hinge[0]"), hinges);
  gl.uniform3fv(uniform("u_tether[0]"), tethers);
  const upperArm = uniform("u_upperArm");
  const elbowOffset = uniform("u_elbowOffset");
  if (parts[0]?.parent) gl.uniform2f(uniform("u_elbow"), ...parts[0].pivot);
  const partAngles = uniform("u_angles");
  const gaze = uniform("u_gaze");
  const lean = uniform("u_lean");
  const release = uniform("u_release");
  const contact = rig.headContact;
  const leavesContact = contact && parts.some(part => part.rigid && part.outline.some(([x, y]) =>
    Math.hypot(x - contact[0], y - contact[1]) < 20));
  const coverSize = uniform("u_coverSize");
  const viewCenter = uniform("u_viewCenter");
  const lift = uniform("u_lift");
  const sway = uniform("u_sway");
  const turn = uniform("u_turn");
  const eyelids = uniform("u_blink");
  gl.uniform1i(uniform("u_artwork"), 0);
  gl.uniform2f(uniform("u_imageSize"), width, height);
  const pivot = rig.headContact ?? [rig.head[0], rig.head[1] + rig.head[3] * 0.72];
  gl.uniform2f(uniform("u_headPivot"), pivot[0], pivot[1]);
  // Anchor each soft part at the edge nearest its attachment to the head.
  function rootOf([x, y, rx, ry]: Region): [number, number] {
    const dx = rig.head[0] - x;
    const dy = rig.head[1] - y;
    const distance = Math.hypot(dx / rx, dy / ry) || 1;
    return [x + dx / distance, y + dy / distance];
  }
  gl.uniform4f(uniform("u_roots"), ...rootOf(rig.sway[0]), ...rootOf(rig.sway[1]));
  const [left, right] = rig.eyes;
  gl.uniform4f(uniform("u_eyeA"), left[0], left[1], left[2], left[3]);
  if (right) gl.uniform4f(uniform("u_eyeB"), right[0], right[1], right[2], right[3]);
  gl.uniform4f(uniform("u_eyeHeights"), left[4], left[5], right?.[4] ?? 0, right?.[5] ?? 0);
  gl.disable(gl.DITHER);

  // Offset the idle rhythm for each painted pose.
  const offset = (rig.head[0] % 13) * 0.058;
  const chestLiftRange = Math.min(5.4, rig.chest[3] * 0.075);
  return {
    resize(cssWidth: number, cssHeight: number) {
      const pixelBudget = view?.maxPixels ?? MAX_RENDER_PIXELS;
      const pixelRatio = Math.min(window.devicePixelRatio, view ? 2 : 1.5, Math.sqrt(pixelBudget / (cssWidth * cssHeight)));
      canvas.width = Math.max(1, Math.round(cssWidth * pixelRatio));
      canvas.height = Math.max(1, Math.round(cssHeight * pixelRatio));
      gl.viewport(0, 0, canvas.width, canvas.height);

      const coverScale = Math.max(cssWidth / width, cssHeight / height);
      const visibleWidth = cssWidth / coverScale;
      gl.uniform2f(coverSize, visibleWidth, cssHeight / coverScale);
      gl.uniform2f(viewCenter, visibleWidth / 2 + (width - visibleWidth) * (view?.focusX ?? 0.5), height / 2);
    },
    draw(seconds: number, look?: { x: number; y: number; attention: number }, sinceGreeting = Infinity, amount = 1) {
      if (gl.isContextLost()) return false;
      const breathPhase = seconds * TAU / (4.8 + offset);
      const headPhase = seconds * TAU / (9.2 + offset);
      const breath = (1 - Math.cos(breathPhase + 0.24 * (1 - Math.cos(breathPhase)))) * 0.5 * amount;
      const beats = layers?.performance.beats;
      // A tap can start the accent between idle performances. Blend from the
      // current pose so touching a moving character cannot reset a limb.
      const greeting = beats && sinceGreeting < beats[4] + 0.65
        ? smoothstep(0, 0.45, sinceGreeting) * (1 - smoothstep(beats[3], beats[4] + 0.65, sinceGreeting)) : 0;
      function accent(delay: number) {
        if (!beats) return 0;
        const idle = gestureAt(seconds - delay, beats);
        return amount * (greeting ? idle + (gestureAt(sinceGreeting - delay, beats) - idle) * greeting : idle);
      }
      const gesture = accent(0);
      const cheekLift = leavesContact ? Math.max(0, accent(-0.26)) * 5 : 0;
      gl.uniform4f(release, contact?.[0] ?? 0, contact?.[1] ?? 0, cheekLift, 0);
      const attention = (look?.attention ?? 0) * amount;
      const lookX = (look?.x ?? 0) * attention;
      const lookY = (look?.y ?? 0) * attention;
      const angle = (rig.headContact ? 0.020 : 0.033) * Math.sin(headPhase) * amount
        + (rig.headContact ? 0.020 : 0.033) * (gesture + lookX * 0.5) + 0.004 * breath;
      // Loose strands and fabric settle just after the head and chest.
      // Ease into their phase lag so the very first frame matches the WebP.
      const settle = smoothstep(0, 1, seconds) * amount;
      const followThrough = (lag: number) => settle * (
        0.023 * Math.sin(headPhase - lag) + 0.009 * Math.sin(breathPhase - lag)
      );
      const cycle = seconds % (23.1 + 2 * offset);
      const idleLift = chestLiftRange * breath;
      const gestureLift = chestLiftRange * 0.33 * gesture;
      const chestLift = idleLift * (rig.chestBreathScale ?? 1) + gestureLift;
      gl.uniform2f(lift, rig.headContact ? 0 : idleLift + gestureLift + 2 * gesture - lookY, chestLift);
      gl.uniform2f(lean, rig.headContact ? 0 : 3.2 * gesture + 1.4 * lookX, 1.4 * gesture);
      gl.uniform2f(gaze, lookX - 0.74 * gesture * (1 - attention), lookY - 0.35 * gesture * (1 - attention));
      if (beats) {
        parts.forEach((part, i) => {
          const t = Math.max(0, seconds - part.follow);
          const motion = accent(part.follow) + amount * 0.12 * Math.sin(t * TAU / (5.8 + offset))
            + attention * (0.16 + 0.08 * lookX);
          angles[i] = motion * part.angle * Math.PI / 180;
          if (part.parent && i === 0) {
            const [x, y, radius, degrees] = part.parent;
            const rotation = degrees * Math.PI / 180 * motion;
            const dx = part.pivot[0] - x, dy = part.pivot[1] - y;
            const c = Math.cos(rotation), s = Math.sin(rotation);
            gl.uniform4f(upperArm, x, y, radius, rotation);
            gl.uniform2f(elbowOffset, (c - 1) * dx - s * dy, s * dx + (c - 1) * dy);
            angles[i] += rotation;
          }
        });
      }
      gl.uniform3fv(partAngles, angles);
      gl.uniform2f(sway, followThrough(0.25), followThrough(0.48));
      gl.uniform2f(turn, Math.cos(angle), Math.sin(angle));
      gl.uniform1f(eyelids, amount * Math.max(
        blink(cycle - 1.45 - offset), blink(cycle - 6.45 + offset),
        blink(cycle - 12.9 - offset), blink(cycle - 16.8 - offset),
      ));
      gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
      return true;
    },
    dispose,
  };
}

export type CharacterWallpaperRenderer = NonNullable<ReturnType<typeof createCharacterWallpaperRenderer>>;
