import type { ArmMesh, Point, Rect } from "./puppet-rig";

export const ARM_SECTIONS = 10;
export const ARM_VERTEX_STRIDE = 12;
const JOINT_INFLUENCE = [0, 0.38, 0.83, 1, 1, 1, 1, 1, 1, 1];

/** Locate an attachment on the same blended distal triangles as the grip artwork. */
export function armGripPoint(stage: ArmMesh["stage"], weights: Float32Array, [section, across]: Point): Point {
  const row = Math.min(Math.floor(section), ARM_SECTIONS - 2);
  const t = section - row;
  const lower = row * 2;
  const upper = lower + 2;
  // Both triangles share the diagonal from the left of the current row to the right of the next.
  const triangle = across >= t
    ? [[lower, 1 - across], [lower + 1, across - t], [upper + 1, t]]
    : [[lower, 1 - t], [upper + 1, across], [upper, t - across]];
  let x = 0, y = 0;
  for (let pose = 0; pose < stage.length; pose++) {
    for (const [vertex, barycentric] of triangle) {
      const [vx, vy] = stage[pose][vertex];
      const weight = weights[pose] * barycentric;
      x += vx * weight;
      y += vy * weight;
    }
  }
  return [x, y];
}

export function armFingerRounding(weights: Float32Array, pairRounding: number[]) {
  let rounding = 0, pair = 0;
  for (let from = 0; from < weights.length; from++) {
    for (let to = from + 1; to < weights.length; to++) {
      rounding += 4 * weights[from] * weights[to] * pairRounding[pair++];
    }
  }
  return rounding;
}

/** Every pose supplies UVs on the same shoulder/elbow/cuff/hand strip. */
export function createArmMesh([left, top, width, height]: Rect, { source, stage }: ArmMesh) {
  const vertices = new Float32Array(ARM_SECTIONS * 2 * ARM_VERTEX_STRIDE);
  const indices = new Uint16Array((ARM_SECTIONS - 1) * 6);
  const previous = new Float32Array(stage.length).fill(-1);
  for (let point = 0; point < ARM_SECTIONS * 2; point++) {
    const offset = point * ARM_VERTEX_STRIDE;
    const section = Math.floor(point / 2);
    vertices[offset + 2] = JOINT_INFLUENCE[section];
    vertices[offset + 3] = section;
    for (let pose = 0; pose < source.length; pose++) {
      const [x, y] = source[pose][point];
      vertices[offset + 4 + pose * 2] = (x - left) / width;
      vertices[offset + 5 + pose * 2] = (y - top) / height;
    }
  }
  for (let section = 0; section < ARM_SECTIONS - 1; section++) {
    const a = section * 2;
    indices.set([a, a + 1, a + 3, a, a + 3, a + 2], section * 6);
  }

  function update(weights: Float32Array) {
    if (weights.every((value, i) => Math.abs(value - previous[i]) < 0.0001)) return false;
    previous.set(weights);
    for (let point = 0; point < ARM_SECTIONS * 2; point++) {
      let x = 0, y = 0;
      for (let pose = 0; pose < stage.length; pose++) {
        x += stage[pose][point][0] * weights[pose];
        y += stage[pose][point][1] * weights[pose];
      }
      vertices[point * ARM_VERTEX_STRIDE] = x;
      vertices[point * ARM_VERTEX_STRIDE + 1] = y;
    }
    return true;
  }
  return { indices, vertices, update };
}
