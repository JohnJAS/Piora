import { BLINKS, EXPRESSIONS, HANDS, MOUTHS } from "./puppet-director.ts";
import { ARM_SECTIONS } from "./puppet-arm-mesh.ts";
import type { PuppetScene } from "./puppet-scenes";

export const PARTS = [
  "back_hair", "cape_skirt", "torso", "arm_back", "prop", "book_page", "head_base",
  "front_hair_l", "front_hair_r", "hair_ornament", "tassel_ribbon",
] as const;
export const BONES = ["torso", "cape_skirt", "head_base", "back_hair", "arm_back", "prop", "book_page",
  "front_hair_l", "front_hair_r", "hair_ornament", "arm_front", "tassel_ribbon"] as const;

export type PartName = typeof PARTS[number];
export type BoneName = typeof BONES[number];
export type Point = [number, number];
export type Rect = [number, number, number, number];
export type Sprite = { rect: Rect; atlas: Rect };
export type SpriteGroup = { rect: Rect; frames: Rect[] };
export type ArmMesh = { source: Point[][]; stage: Point[][]; distanceRange: number; fingerRoundingPx: number[] };
type Bone = { pivot: Point; parent: BoneName | null; depth: number };
type Lamp = { center: Point; bookGrip: Point; handGrip: Point };
type InkPen = { sprite: Sprite; grip: Point; handGrip: Point };

export type PuppetRig = {
  version: 2;
  stage: [number, number];
  focusX: number;
  scene?: PuppetScene;
  lamp?: Lamp;
  inkPen?: InkPen;
  bones: Record<BoneName, Bone>;
  parts: Record<PartName, Sprite>;
  hands: SpriteGroup;
  armMesh: ArmMesh;
  armCape: Sprite;
  expressions: SpriteGroup;
  blinks: SpriteGroup;
  mouths: SpriteGroup;
  eyes: [Point, Point];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function tuple(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite);
}

function rect(value: unknown): value is Rect {
  return tuple(value, 4) && value[2] > 0 && value[3] > 0;
}

function inside(value: unknown, width: number, height: number) {
  return rect(value) && value[0] >= 0 && value[1] >= 0
    && value[0] + value[2] <= width && value[1] + value[3] <= height;
}

function group(value: unknown, count: number, atlas: HTMLImageElement) {
  return isObject(value) && rect(value.rect) && Array.isArray(value.frames) && value.frames.length === count
    && value.frames.every((frame) => inside(frame, atlas.naturalWidth, atlas.naturalHeight));
}

function sprite(value: unknown, atlas: HTMLImageElement) {
  return isObject(value) && rect(value.rect) && inside(value.atlas, atlas.naturalWidth, atlas.naturalHeight);
}

function armPoints(value: unknown) {
  return Array.isArray(value) && value.length === HANDS.length
    && value.every(pose => Array.isArray(pose) && pose.length === ARM_SECTIONS * 2
      && pose.every(point => tuple(point, 2)));
}

function handGrip(value: unknown) {
  return tuple(value, 2) && value[0] >= 4 && value[0] <= ARM_SECTIONS - 1 && value[1] >= 0 && value[1] <= 1;
}

/** Fail to the prepainted wallpaper if a skin is missing or incorrectly baked. */
export function readPuppetRig(value: unknown, stage: HTMLImageElement, parts: HTMLImageElement, face: HTMLImageElement): PuppetRig {
  if (!isObject(value) || value.version !== 2 || !tuple(value.stage, 2)
    || value.stage[0] !== stage.naturalWidth || value.stage[1] !== stage.naturalHeight
    || typeof value.focusX !== "number" || !Number.isFinite(value.focusX) || value.focusX < 0 || value.focusX > 1
    || !Array.isArray(value.eyes) || value.eyes.length !== 2 || !value.eyes.every((eye) => tuple(eye, 2))
    || !isObject(value.bones) || !isObject(value.parts)) throw new Error("Invalid puppet rig");

  if (value.scene !== undefined && value.scene !== "paper" && value.scene !== "lamp" && value.scene !== "autumn") {
    throw new Error("Unknown puppet scene");
  }
  const lamp = value.lamp;
  if (value.scene === "lamp" && (!isObject(lamp) || !tuple(lamp.center, 2) || !tuple(lamp.bookGrip, 2)
    || !handGrip(lamp.handGrip))) throw new Error("Missing lamp or book anchors");
  const pen = value.inkPen;
  if (value.scene === "autumn" && (!isObject(pen) || !sprite(pen.sprite, parts) || !tuple(pen.grip, 2)
    || !handGrip(pen.handGrip))) throw new Error("Missing pen or hand anchors");

  const bones = value.bones;
  const sprites = value.parts;
  const validBones = BONES.every((name, index) => {
    const bone = bones[name];
    return isObject(bone) && tuple(bone.pivot, 2) && typeof bone.depth === "number" && Number.isFinite(bone.depth)
      && (bone.parent === null || BONES.slice(0, index).some((parent) => parent === bone.parent));
  });
  const validSprites = PARTS.every(name => sprite(sprites[name], parts));
  const armMesh = value.armMesh;
  if (!validBones || !validSprites || !group(value.hands, HANDS.length, parts)
    || !sprite(value.armCape, parts) || !isObject(armMesh) || !armPoints(armMesh.source) || !armPoints(armMesh.stage)
    || !tuple(armMesh.fingerRoundingPx, 6)
    || typeof armMesh.distanceRange !== "number" || !Number.isFinite(armMesh.distanceRange) || armMesh.distanceRange <= 0
    || !group(value.expressions, EXPRESSIONS.length, face) || !group(value.blinks, BLINKS.length, face)
    || !group(value.mouths, MOUTHS.length, face)) throw new Error("Incomplete puppet rig");
  return value as unknown as PuppetRig;
}

export function puppetCover(width: number, height: number, stage: Point, focusX: number) {
  const scale = Math.max(width / stage[0], height / stage[1]);
  return {
    scale,
    left: (width - stage[0] * scale) * focusX,
    top: (height - stage[1] * scale) * 0.5,
  };
}

export function puppetSurfaceSize(width: number, height: number, dpr: number, limitX: number, limitY: number) {
  const ratio = Math.min(dpr, 1.5, Math.sqrt(1_600_000 / (width * height)), limitX / width, limitY / height);
  return {
    width: Math.min(1_600_000, Math.max(1, Math.floor(width * ratio))),
    height: Math.min(1_600_000, Math.max(1, Math.floor(height * ratio))),
  };
}
