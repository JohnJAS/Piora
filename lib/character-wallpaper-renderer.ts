import type { CharacterWallpaperRig } from "./character-wallpaper-rigs";

const VERTEX_SOURCE = `
  attribute vec2 a_position;
  varying vec2 v_screen;
  void main() {
    v_screen = a_position * vec2(0.5, -0.5) + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const FRAGMENT_SOURCE = `
  precision highp float;
  varying vec2 v_screen;
  uniform sampler2D u_artwork;
  uniform vec2 u_imageSize;
  uniform vec2 u_coverSize;
  uniform float u_subjectLeft;
  uniform vec4 u_head;
  uniform vec4 u_shoulders;
  uniform vec4 u_swayA;
  uniform vec4 u_swayB;
  uniform vec4 u_eyeA;
  uniform vec4 u_eyeB;
  uniform vec4 u_eyeHeights;
  uniform vec4 u_pose; // breath, turn, hair A, hair B
  uniform vec2 u_turn; // cosine, sine of the head angle
  uniform float u_blink;

  float influence(vec2 offset) {
    return 1.0 - smoothstep(0.27, 1.0, dot(offset, offset));
  }

  vec3 artworkAt(vec2 point) {
    return texture2D(u_artwork, point / u_imageSize).rgb;
  }

  // In the eye's local frame, lower the upper lid and narrow the iris. Use
  // neighboring skin for the lid so hair and brows never stretch with it.
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
    float irisY = mix(upper, lower, clamp((vertical - lidTop) / (lidBottom - lidTop), 0.0, 1.0));
    float aperture = smoothstep(lidTop - 0.7, lidTop + 0.5, vertical)
      * (1.0 - smoothstep(lidBottom - 0.5, lidBottom + 0.7, vertical))
      * (1.0 - smoothstep(0.83, 1.0, u_blink));
    vec3 iris = artworkAt(point + down * (irisY - vertical));
    float crease = 1.0 - smoothstep(0.0, 4.0 + 0.05 * width, abs(vertical - lidTop + 3.2 * arc));
    vec3 lid = mix(skin * (1.0 - 0.075 * arc * crease * u_blink), iris, aperture);

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

  vec2 deformCharacter(vec2 point) {
    vec2 shoulders = (point - u_shoulders.xy) / u_shoulders.zw;
    vec2 head = (point - u_head.xy) / u_head.zw;
    float headWeight = influence(head);
    vec2 pivot = u_head.xy + vec2(0.0, u_head.w * 0.72);
    vec2 fromPivot = point - pivot;
    mat2 rotate = mat2(u_turn.x, u_turn.y, -u_turn.y, u_turn.x);
    vec2 turned = rotate * fromPivot - fromPivot;
    vec2 motion = headWeight * (turned + vec2(3.6 * u_pose.y, 6.0 * u_pose.x));
    motion += influence(shoulders) * u_pose.x * vec2(-5.0 * shoulders.x, 8.5 - 5.0 * shoulders.y);
    motion += (1.0 - headWeight) * (
      influence((point - u_swayA.xy) / u_swayA.zw) * u_pose.z * vec2(13.0, 10.0) +
      influence((point - u_swayB.xy) / u_swayB.zw) * u_pose.w * vec2(-11.0, 15.0)
    );
    return point + motion;
  }

  void main() {
    vec2 point = (v_screen - 0.5) * u_coverSize + 0.5 * u_imageSize;
    if (point.x >= u_subjectLeft) point = deformCharacter(point);
    vec3 color = artworkAt(point);
    if (u_blink > 0.0 && influence((point - u_head.xy) / u_head.zw) > 0.0) {
      color = blinkEye(color, point, u_eyeA, u_eyeHeights.xy);
      color = blinkEye(color, point, u_eyeB, u_eyeHeights.zw);
    }
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
  const texture = gl.createTexture();
  function dispose() {
    gl.deleteTexture(texture);
    gl.deleteBuffer(vertices);
    gl.deleteProgram(program);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
  if (!program || !vertices || !texture) {
    dispose();
    return null;
  }

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const width = artwork.naturalWidth;
  const height = artwork.naturalHeight;
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
  const coverSize = uniform("u_coverSize");
  const pose = uniform("u_pose");
  const turn = uniform("u_turn");
  const eyelids = uniform("u_blink");
  gl.uniform1i(uniform("u_artwork"), 0);
  gl.uniform2f(uniform("u_imageSize"), width, height);
  gl.uniform1f(uniform("u_subjectLeft"), Math.min(
    ...[rig.head, rig.shoulders, ...rig.sway].map(([x, , rx]) => x - rx),
  ));
  gl.uniform4f(uniform("u_head"), ...rig.head);
  gl.uniform4f(uniform("u_shoulders"), ...rig.shoulders);
  gl.uniform4f(uniform("u_swayA"), ...rig.sway[0]);
  gl.uniform4f(uniform("u_swayB"), ...rig.sway[1]);
  const [left, right] = rig.eyes;
  gl.uniform4f(uniform("u_eyeA"), left[0], left[1], left[2], left[3]);
  if (right) gl.uniform4f(uniform("u_eyeB"), right[0], right[1], right[2], right[3]);
  gl.uniform4f(uniform("u_eyeHeights"), left[4], left[5], right?.[4] ?? 0, right?.[5] ?? 0);
  gl.disable(gl.DITHER);

  // Slightly stagger the two blinks and head turns among the different poses.
  const offset = (rig.head[0] % 13) * 0.058;
  return {
    resize(cssWidth: number, cssHeight: number) {
      const pixelRatio = Math.min(window.devicePixelRatio, 1.5, Math.sqrt(MAX_RENDER_PIXELS / (cssWidth * cssHeight)));
      canvas.width = Math.max(1, Math.round(cssWidth * pixelRatio));
      canvas.height = Math.max(1, Math.round(cssHeight * pixelRatio));
      gl.viewport(0, 0, canvas.width, canvas.height);

      const coverScale = Math.max(cssWidth / width, cssHeight / height);
      gl.uniform2f(coverSize, cssWidth / coverScale, cssHeight / coverScale);
    },
    draw(seconds: number) {
      if (gl.isContextLost()) return false;
      const breath = (1 - Math.cos(seconds * TAU / 4.8)) * 0.5;
      const head = Math.sin(seconds * TAU / (8.2 + offset));
      const angle = head * 0.041;
      const firstSway = Math.sin(seconds * TAU / 5.4);
      const secondSway = Math.sin(seconds * TAU / 6.3);
      const cycle = seconds % (11.7 + offset);
      gl.uniform4f(pose, breath, head, firstSway, secondSway);
      gl.uniform2f(turn, Math.cos(angle), Math.sin(angle));
      gl.uniform1f(eyelids, Math.max(blink(cycle - 1.45 - offset), blink(cycle - 6.45 + offset)));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return true;
    },
    dispose,
  };
}

export type CharacterWallpaperRenderer = NonNullable<ReturnType<typeof createCharacterWallpaperRenderer>>;
