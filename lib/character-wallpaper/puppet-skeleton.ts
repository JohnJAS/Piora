import { armGripPoint } from "./puppet-arm-mesh.ts";
import { BONES, type BoneName, type Point, type PuppetRig } from "./puppet-rig.ts";
import type { PuppetFrame } from "./puppet-director";

export const IDENTITY_MATRIX = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
type JointPose = { angle?: number; x?: number; y?: number; scaleX?: number; scaleY?: number };

function transform([x, y]: Point, matrix: Float32Array): Point {
  return [matrix[0] * x + matrix[3] * y + matrix[6], matrix[1] * x + matrix[4] * y + matrix[7]];
}

function jointMatrix(out: Float32Array, parent: Float32Array, x: number, y: number, rotation: JointPose, parallaxX: number, parallaxY: number) {
  const theta = (rotation.angle ?? 0) * Math.PI / 180;
  const cosine = Math.cos(theta), sine = Math.sin(theta);
  const a = cosine * (rotation.scaleX ?? 1), b = sine * (rotation.scaleX ?? 1);
  const c = -sine * (rotation.scaleY ?? 1), d = cosine * (rotation.scaleY ?? 1);
  const tx = x + (rotation.x ?? 0) + parallaxX - a * x - c * y;
  const ty = y + (rotation.y ?? 0) + parallaxY - b * x - d * y;
  out[0] = parent[0] * a + parent[3] * b;
  out[1] = parent[1] * a + parent[4] * b;
  out[3] = parent[0] * c + parent[3] * d;
  out[4] = parent[1] * c + parent[4] * d;
  out[6] = parent[0] * tx + parent[3] * ty + parent[6];
  out[7] = parent[1] * tx + parent[4] * ty + parent[7];
}

export function createPuppetSkeleton(rig: PuppetRig) {
  const matrices = Object.fromEntries(BONES.map((name) => [name, IDENTITY_MATRIX.slice()])) as Record<BoneName, Float32Array>;
  const followsBook = new Set<BoneName>(["prop"]);
  for (const bone of BONES) {
    const parent = rig.bones[bone].parent;
    if (parent && followsBook.has(parent)) followsBook.add(bone);
  }
  return (frame: PuppetFrame) => {
    const p = frame.pose;
    const pose: Record<BoneName, JointPose> = {
      torso: { angle: p.lean, y: p.lift, scaleY: 1 - p.lift * 0.0012 },
      cape_skirt: {},
      head_base: { angle: p.head, x: p.headX, y: p.headY, scaleX: 1 + p.gazeX * 0.011 },
      back_hair: { angle: p.backHair * 0.24 },
      arm_back: { angle: p.book * 0.35 },
      prop: { angle: p.book, y: p.page * -2 },
      book_page: { angle: p.page * -22, scaleX: 1 - p.page * 0.68, y: p.page * -8 },
      front_hair_l: { angle: p.bangs * 0.66 },
      front_hair_r: { angle: p.bangs * 0.85 },
      hair_ornament: { angle: p.ornament },
      arm_front: { angle: p.arm, y: p.wave * -2 },
      tassel_ribbon: { angle: p.silk },
    };
    for (const name of BONES) {
      const bone = rig.bones[name];
      const parent = bone.parent ? matrices[bone.parent] : IDENTITY_MATRIX;
      const depth = bone.depth - (bone.parent ? rig.bones[bone.parent].depth : 0);
      jointMatrix(matrices[name], parent, ...bone.pivot, pose[name], depth * p.gazeX * 8, depth * p.gazeY * 5);
    }
    if (rig.lamp && p.bookCarry > 0) {
      const hand = armGripPoint(rig.armMesh.stage, frame.hand, rig.lamp.handGrip);
      const [handX, handY] = transform(hand, matrices.arm_front);
      const [bookX, bookY] = transform(rig.lamp.bookGrip, matrices.prop);
      const pickup = Math.min(1, p.bookCarry * 3);
      const grip = pickup * pickup * (3 - 2 * pickup);
      for (const bone of followsBook) {
        matrices[bone][6] += (handX - bookX) * grip;
        matrices[bone][7] += (handY - bookY) * grip;
      }
    }
    return matrices;
  };
}
