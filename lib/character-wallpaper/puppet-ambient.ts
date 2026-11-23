// vUnit spans only the clipped ambient quad, never the chat portion of the stage.
export const LAMP_AMBIENT = `
precision FLOAT_PRECISION float;
uniform float uTime;
uniform vec2 uExtent;
uniform vec2 uLamp;
uniform float uGlow;
varying vec2 vUnit;
void main() {
  vec2 lampOffset = (vUnit * uExtent - uLamp) / vec2(112.0, 96.0);
  float halo = exp(-dot(lampOffset, lampOffset) * 1.8);
  float breath = 0.5 + 0.5 * sin(uTime * 1.4);
  float alpha = halo * (0.036 + 0.036 * breath + 0.092 * uGlow);
  for (int i = 0; i < 6; i++) {
    float seed = float(i);
    float y = 1.0 - fract(seed * 0.27691 + uTime * (0.012 + 0.0014 * seed));
    float x = 0.22 + 0.66 * fract(0.28 + seed * 0.61803) + 0.045 * sin(uTime * 0.68 + seed);
    float radius = length((vUnit - vec2(x, y)) * uExtent);
    float fade = smoothstep(0.1, 0.25, y) * (1.0 - smoothstep(0.79, 0.99, y));
    alpha += (1.0 - smoothstep(0.45, 1.9 + 0.13 * seed, radius)) * fade * 0.44;
  }
  alpha *= smoothstep(0.0, 0.10, vUnit.x);
  gl_FragColor = vec4(vec3(1.0, 0.69, 0.30) * alpha, alpha);
}`;

export const AUTUMN_AMBIENT = `
precision FLOAT_PRECISION float;
uniform float uTime;
uniform vec2 uExtent;
varying vec2 vUnit;
void main() {
  float alpha = 0.0;
  for (int i = 0; i < 3; i++) {
    float seed = float(i);
    float y = fract(0.08 + seed * 0.329 + uTime * (0.028 + seed * 0.0028));
    float x = 0.29 + 0.23 * seed - 0.19 * y + 0.072 * sin(uTime * 0.67 + seed * 1.7);
    vec2 offset = (vUnit - vec2(x, y)) * uExtent;
    float turn = uTime * (0.44 - 0.14 * seed) + seed * 2.2;
    float c = cos(turn);
    float s = sin(turn);
    vec2 p = mat2(c, -s, s, c) * offset / (0.91 + 0.14 * seed);
    // Two rounded lobes and a stem form the silhouette of a small ginkgo leaf.
    float lobe = min(length((p - vec2(2.5, -1.5)) / vec2(4.1, 3.3)),
                     length((p - vec2(-2.5, -1.5)) / vec2(4.1, 3.3)));
    float stem = (1.0 - smoothstep(0.2, 0.95, abs(p.x + p.y * 0.2)))
      * smoothstep(1.0, 2.0, p.y) * (1.0 - smoothstep(4.0, 5.0, p.y));
    float fade = smoothstep(0.0, 0.13, y) * (1.0 - smoothstep(0.86, 1.0, y));
    alpha += max(1.0 - smoothstep(0.82, 1.08, lobe), stem) * fade * 0.44;
  }
  alpha = min(alpha, 0.84) * smoothstep(0.0, 0.06, vUnit.x);
  gl_FragColor = vec4(vec3(0.86, 0.47, 0.17) * alpha, alpha);
}`;
