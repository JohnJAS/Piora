"""Bake a Claude puppet from untouched image_gen PNGs and measured placements.

Usage: python scripts/bake-claude-puppet.py --source RAW --placement PLACEMENT.json
       --reference ORIGINAL.webp --evidence EVIDENCE_DIRECTORY [--output SKIN_DIRECTORY]

Source crops and polygons use original PNG pixels. A part's optional rect places the
crop on the 1672x941 stage. Face landmarks are measured in crop-local pixels;
their targets and the feathered face polygons are measured in stage pixels.
"""

from argparse import ArgumentParser
from collections.abc import Mapping
from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
import json
import math
from pathlib import Path
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent / "claude-puppet"))
from arm_mesh import DISTANCE_RANGE, correspondence, distance_texture, preview_pose


STAGE = (1672, 941)
OUTPUT_ROOT = Path(__file__).resolve().parents[1] / "public/themes/character-backgrounds/claude-live"
BUDGET = 2_800_000
MAX_DRIFT = 1.5
ATLAS_MAX = 2048
GUTTER = 3
LANDMARKS = ("eyeLeft", "eyeRight", "nose", "chin")
PARTS = (
    "back_hair", "cape_skirt", "torso", "arm_back", "prop", "book_page",
    "head_base", "front_hair_l", "front_hair_r", "hair_ornament", "tassel_ribbon",
)
HAND_NAMES = ("idle", "page_turn", "chin_rest", "wave_greet")
FACE_GROUPS = {
    "expressions": ("neutral", "smile", "thinking", "focused", "worried", "sleepy"),
    "blinks": ("open", "half", "closed"),
    "mouths": ("closed", "half", "open"),
}
BONE_ORDER = {
    "torso": (None, 0.26), "cape_skirt": (None, 0), "head_base": ("torso", 0.69),
    "back_hair": ("head_base", 0.16), "arm_back": ("torso", 0.32), "prop": ("arm_back", 0.53),
    "book_page": ("prop", 0.55), "front_hair_l": ("head_base", 0.77),
    "front_hair_r": ("head_base", 0.77), "hair_ornament": ("head_base", 0.82),
    "arm_front": ("torso", 0.58), "tassel_ribbon": ("torso", 0.50),
}


@dataclass
class Cel:
    image: Image.Image
    rect: tuple[int, int, int, int]


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def file_crop(image, crop=None):
    if crop is None:
        return image
    x, y, w, h = crop
    if min(x, y) < 0 or min(w, h) <= 0 or x + w > image.width or y + h > image.height:
        raise ValueError(f"Crop {crop} is outside {image.size}")
    return image.crop((x, y, x + w, y + h))


class SourceImages:
    def __init__(self, root):
        self.root = root.resolve()
        self.images = {}
        self.hashes = {}

    def get(self, filename):
        if filename not in self.images:
            path = (self.root / filename).resolve()
            if not path.is_relative_to(self.root):
                raise ValueError(f"Source path escapes the raw directory: {filename}")
            with Image.open(path) as image:
                if image.format != "PNG":
                    raise ValueError(f"{filename} must be an original PNG")
                self.images[filename] = image.convert("RGBA")
            self.hashes[filename] = digest(path)
        return self.images[filename]


def clean_alpha(image, minimum_component=26):
    pixels = np.array(image, dtype=np.uint8)
    alpha = pixels[:, :, 3]
    if not np.any(alpha < 255) or not np.any(alpha > 222):
        raise ValueError("A part must contain real transparency and opaque painted pixels")
    _, regions, stats, _ = cv2.connectedComponentsWithStats((alpha > 8).astype(np.uint8), connectivity=8)
    keep = stats[:, cv2.CC_STAT_AREA] >= minimum_component
    keep[0] = False
    connected = keep[regions].astype(np.uint8)
    nearby = cv2.dilate(connected, np.ones((5, 5), np.uint8)).astype(bool)
    removed = int(np.count_nonzero((alpha > 0) & ~nearby))
    alpha[~nearby] = 0
    opaque = alpha >= 224
    edge = (alpha > 0) & ~opaque
    # Borrow colour only at translucent edges. The alpha and interior highlights
    # stay intact, including thin strands connected to the painted hair.
    if np.any(edge):
        _, nearest = cv2.distanceTransformWithLabels((~opaque).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
        palette = np.zeros((nearest.max() + 1, 3), dtype=np.float32)
        palette[nearest[opaque]] = pixels[:, :, :3][opaque]
        edge_rgb = pixels[:, :, :3][edge].astype(np.float32)
        edge_anchor = palette[nearest[edge]]
        difference = np.max(np.abs(edge_rgb - edge_anchor), axis=1)
        strength = np.clip((224 - alpha[edge].astype(np.float32)) / 224, 0, 1)
        weight = (strength * np.clip((difference - 17) / 73, 0, 1))[:, None]
        pixels[:, :, :3][edge] = np.round(edge_rgb * (1 - weight) + edge_anchor * weight).astype(np.uint8)
    pixels[alpha == 0] = 0
    return Image.fromarray(pixels), removed


def polygon_mask(size, polygons, shift=(0, 0), feather=0):
    mask = np.zeros((size[1], size[0]), dtype=np.uint8)
    if polygons and isinstance(polygons[0][0], (int, float)):
        polygons = [polygons]
    for polygon in polygons:
        points = np.round(np.array(polygon) - np.array(shift)).astype(np.int32)
        cv2.fillPoly(mask, [points], 255)
    if feather > 0:
        # Feather inward so an eye/mouth patch never smears onto adjacent hair.
        distance = cv2.distanceTransform((mask > 0).astype(np.uint8), cv2.DIST_L2, 5)
        mask = np.round(np.minimum(1, distance / feather) * 255).astype(np.uint8)
    return mask


def mask_image(image, mask):
    pixels = np.array(image, dtype=np.uint8)
    alpha = (pixels[:, :, 3].astype(np.uint16) * mask + 127) // 255
    pixels[:, :, 3] = alpha
    pixels[alpha == 0] = 0
    return Image.fromarray(pixels)


def prep_part(sources, spec):
    if "layers" in spec:
        pieces = [prep_part(sources, layer) for layer in spec["layers"]]
        common = shared_rect([piece for piece, _ in pieces])
        image = Image.new("RGBA", common[0].image.size)
        for cel in common:
            image.alpha_composite(cel.image)
        return Cel(image, common[0].rect), sum(count for _, count in pieces)
    image = sources.get(spec["file"])
    if spec.get("polygon"):
        image = mask_image(image, polygon_mask(image.size, spec["polygon"], feather=spec.get("feather", 0)))
    if spec.get("subtract"):
        image = mask_image(image, 255 - polygon_mask(image.size, spec["subtract"], feather=spec.get("subtractFeather", 0)))
    crop = spec.get("crop", [0, 0, *image.size])
    rect = spec.get("rect", crop)
    image = file_crop(image, crop)
    image, removed = clean_alpha(image, spec.get("minimumComponent", 26))
    if image.size != tuple(rect[2:]):
        image = image.resize(tuple(rect[2:]), Image.Resampling.LANCZOS)
    box = image.getbbox(alpha_only=True)
    if not box:
        raise ValueError(f"Empty part after alpha cleanup: {spec['file']}")
    x, y, r, b = box
    return Cel(image.crop(box), (rect[0] + x, rect[1] + y, r - x, b - y)), removed


def stage_from_source(sources, setup, reference):
    incoming = file_crop(sources.get(setup["file"]), setup.get("crop"))
    if incoming.getchannel("A").getextrema() != (255, 255):
        raise ValueError("Stage PNG must be opaque")
    if incoming.size == (STAGE[0] - 1, STAGE[1]):
        # Preserve the coordinates of all original columns when the generator omits the last one.
        padded = incoming.convert("RGB").resize(STAGE, Image.Resampling.NEAREST)
        padded.paste(incoming, (0, 0))
        incoming = padded
    elif incoming.size != STAGE:
        raise ValueError(f"Expected a {STAGE} stage after cropping, found {incoming.size}")
    master = sources.get(setup["maskSource"])
    cleaned, removed = clean_alpha(master)
    matte = cleaned.getchannel("A")
    if "maskPlacement" in setup:
        placement = setup["maskPlacement"]
        mask_canvas = Image.new("L", STAGE)
        matte = file_crop(matte, placement.get("crop"))
        x, y, width, height = placement["rect"]
        mask_canvas.paste(matte.resize((width, height), Image.Resampling.LANCZOS), (x, y))
        matte = mask_canvas
    elif matte.size == (STAGE[0] - 1, STAGE[1]):
        matte = matte.resize(STAGE, Image.Resampling.NEAREST)
        matte.paste(cleaned.getchannel("A"), (0, 0))
    elif matte.size != STAGE:
        raise ValueError("Stage mask needs a placement when it differs from the reference canvas")
    mask = (np.asarray(matte) > 5).astype(np.uint8)
    if "cover" in setup:
        # Cover original hair or fingers outside the registered generator silhouette.
        mask |= polygon_mask(STAGE, setup["cover"]) > 0
    radius = setup.get("radius", 14)
    feather = setup.get("feather", 16)
    distance = cv2.distanceTransform(1 - mask, cv2.DIST_L2, 5)
    weight = 1 - np.clip((distance - radius) / feather, 0, 1)
    weight = weight * weight * (3 - 2 * weight)
    original_rgb = np.asarray(reference, dtype=np.float32)
    incoming_rgb = np.asarray(incoming.convert("RGB"), dtype=np.float32)
    mixed = np.round(incoming_rgb * weight[:, :, None] + original_rgb * (1 - weight[:, :, None])).astype(np.uint8)
    stage = Image.fromarray(mixed)
    return stage, weight, {"repaintedPixels": int(np.count_nonzero(weight)), "removedAlphaSpecks": removed}


def face_landmarks(data, size=None):
    points = np.array([data[name] for name in LANDMARKS], dtype=np.float64)
    if points.shape != (4, 2) or not np.all(np.isfinite(points)):
        raise ValueError("Expected four measured facial landmarks")
    if size is not None and (np.any(points < 0) or np.any(points >= size)):
        raise ValueError("Face landmark is outside its crop")
    return points


def face_transform(points, target):
    centered = points - points.mean(axis=0)
    design = np.column_stack((centered, np.ones(len(points))))
    # Four measured landmarks constrain a three-column affine fit per axis.
    # Distribute the irreducible residual equally to minimize its maximum
    # Euclidean length instead of concentrating the error on a single feature.
    basis, singular, _ = np.linalg.svd(design, full_matrices=True)
    if singular[-1] < 1e-8:
        raise ValueError("Facial landmarks do not span a plane")
    constraint = basis[:, -1]
    correction = np.sign(constraint)[:, None] * (constraint @ target) / np.abs(constraint).sum()
    parameters, _, rank, _ = np.linalg.lstsq(design, target - correction, rcond=None)
    scale_rotation = parameters[:2]
    if rank != 3 or np.linalg.det(scale_rotation) <= 0 or np.linalg.cond(scale_rotation) > 1.35:
        raise ValueError("Facial measurements imply excessive skew or reflection")
    shift = parameters[2] - points.mean(axis=0) @ scale_rotation
    projected = points @ scale_rotation + shift
    distances = np.linalg.norm(projected - target, axis=1)
    return np.column_stack((scale_rotation.T, shift)), projected, distances


def track_landmarks(source, sample, guides, offsets):
    gray = cv2.cvtColor(np.asarray(source), cv2.COLOR_RGBA2GRAY)
    template = cv2.cvtColor(np.asarray(sample), cv2.COLOR_RGBA2GRAY)
    results, scores = [], {}
    window, search = 8, 12
    for label, (x, y) in zip(LANDMARKS, guides):
        ox, oy = offsets.get(label, (0, 0))
        ix, iy = int(round(x + ox)), int(round(y + oy))
        l, t, r, b = ix - window, iy - window, ix + window + 1, iy + window + 1
        search_area = gray[t-search:b+search, l-search:r+search]
        if min(l, t) < search or max(r + search - source.width, b + search - source.height) > 0:
            raise ValueError("Landmark search must have a margin within its crop")
        match = cv2.matchTemplate(search_area, template[t:b, l:r], cv2.TM_CCOEFF_NORMED)
        _, score, _, (dx, dy) = cv2.minMaxLoc(match)

        def subpixel(left, middle, right):
            denominator = left - 2 * middle + right
            return float(np.clip(0.5 * (left - right) / denominator, -0.5, 0.5)) if denominator < -1e-5 else 0

        if score < 0.56 or not (0 < dx < match.shape[1] - 1 and 0 < dy < match.shape[0] - 1):
            raise ValueError(f"Unable to track {label} at {(x, y)} (correlation {score:.3f})")
        shift_x = dx - search + subpixel(match[dy, dx-1], score, match[dy, dx+1])
        shift_y = dy - search + subpixel(match[dy-1, dx], score, match[dy+1, dx])
        results.append([x + shift_x, y + shift_y])
        scores[label] = float(score)
    return np.asarray(results), scores


def bake_face(sources, spec, target, rect, mask, tracking):
    image = file_crop(sources.get(spec["file"]), spec.get("crop"))
    if "landmarks" in spec:
        points = face_landmarks(spec["landmarks"], image.size)
        scores = None
    elif tracking:
        points, scores = track_landmarks(image, *tracking)
    else:
        raise ValueError("Provide measured landmarks or a tracked template")
    transform, project, error = face_transform(points, target)
    relative_transform = transform.copy()
    relative_transform[:, 2] -= rect[:2]
    warped = cv2.warpAffine(np.asarray(image), relative_transform, tuple(rect[2:]), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT)
    face = mask_image(Image.fromarray(warped), mask)
    if np.count_nonzero(np.asarray(face.getchannel("A")) > 128) < 40:
        raise ValueError(f"Face patch does not cover its landmarks: {spec['file']}")
    measurement = {
        "sourceLandmarks": dict(zip(LANDMARKS, points.tolist())),
        "projectedLandmarks": dict(zip(LANDMARKS, project.round(4).tolist())),
        "errorPx": dict(zip(LANDMARKS, error.round(6).tolist())),
        "maxDriftPx": float(error.max()),
        "rmsePx": float(np.sqrt(np.mean(error ** 2))),
        "templateCorrelation": scores,
    }
    if "landmarkTrace" in spec:
        measurement["sourceRegistration"] = spec["landmarkTrace"]
    return Cel(face, tuple(rect)), measurement


def shared_rect(parts):
    left = min(cel.rect[0] for cel in parts)
    top = min(cel.rect[1] for cel in parts)
    right = max(cel.rect[0] + cel.rect[2] for cel in parts)
    bottom = max(cel.rect[1] + cel.rect[3] for cel in parts)
    rect = (left, top, right - left, bottom - top)
    frames = []
    for cel in parts:
        frame = Image.new("RGBA", rect[2:])
        frame.paste(cel.image, (cel.rect[0] - left, cel.rect[1] - top))
        frames.append(Cel(frame, rect))
    return frames


def pack_atlas(cels: Mapping[str, Cel]):
    shelves = []
    layout = {}
    for name, cel in sorted(cels.items(), key=lambda item: -item[1].image.height):
        w, h = cel.image.size
        if max(w, h) + 2 * GUTTER > ATLAS_MAX:
            raise ValueError(f"{name} exceeds atlas dimensions")
        shelf = next((row for row in shelves if row["used"] + w + GUTTER <= ATLAS_MAX), None)
        if shelf is None:
            y = sum(row["height"] for row in shelves)
            shelf = {"used": GUTTER, "y": y, "height": h + 2 * GUTTER}
            shelves.append(shelf)
        layout[name] = (shelf["used"], shelf["y"] + GUTTER, w, h)
        shelf["used"] += w + 2 * GUTTER
    height = sum(row["height"] for row in shelves)
    if height > ATLAS_MAX:
        raise ValueError("Parts exceed maximum atlas packing height")
    atlas = Image.new("RGBA", (min(ATLAS_MAX, max(row["used"] for row in shelves)), height))
    for name, (x, y, _, _) in layout.items():
        atlas.paste(cels[name].image, (x, y))
    return atlas, layout


def webp(image, *, lossless=False, quality=88):
    output = BytesIO()
    image.save(output, "WEBP", lossless=lossless, quality=quality, alpha_quality=100, method=6)
    return output.getvalue()


def overlay(frame, cel):
    frame.alpha_composite(cel.image, cel.rect[:2])


def compose(stage, parts, hands, faces, expression="expressions/neutral", hand="hands/idle"):
    frame = stage.convert("RGBA")
    for name in PARTS:
        if name != "book_page":
            overlay(frame, parts[name])
        if name == "head_base":
            overlay(frame, faces[expression])
    overlay(frame, hands[hand])
    overlay(frame, parts["cape_join"])
    return frame


def checkerboard(size, step=12):
    yy, xx = np.indices((size[1], size[0]))
    levels = np.where((xx // step + yy // step) % 2, 148, 102).astype(np.uint8)
    return Image.fromarray(levels).convert("RGB")


def contact_sheet(path, reference, stage, parts, hands, faces, target, measurements, scene, framing):
    width, cell_w, cell_h = 1440, 240, 196
    sheet = Image.new("RGB", (width, 1710), (33, 30, 28))
    draw = ImageDraw.Draw(sheet)
    draw.text((16, 12), f"CLAUDE {scene.upper()} - ANNOTATED IMAGE_GEN BAKE", fill=(255, 237, 215))
    composite = compose(stage, parts, hands, faces)
    for index, (caption, image) in enumerate((("Original wallpaper", reference), ("Rest pose", composite), ("Clean stage", stage))):
        thumbnail = image.copy()
        thumbnail.thumbnail((466, 285))
        x = index * 480 + 7
        draw.text((x, 43), caption, fill="white")
        sheet.paste(thumbnail, (x, 64))
    for index, (name, cel) in enumerate([*parts.items(), *hands.items()]):
        row, col = divmod(index, 6)
        x, y = col * cell_w + 5, 347 + row * cell_h
        tile = checkerboard((cell_w - 10, cell_h - 29))
        sprite = cel.image.copy()
        sprite.thumbnail(tile.size)
        tile.paste(sprite, ((tile.width - sprite.width) // 2, (tile.height - sprite.height) // 2), sprite)
        draw.text((x, y), name, fill="white")
        sheet.paste(tile, (x, y + 21))
    marks = ("#3df3f3", "#f8ce6a", "#ef9ee7", "#b3efae")
    for index, (name, cel) in enumerate(faces.items()):
        row, col = divmod(index, 6)
        x, y = col * cell_w + 5, 935 + row * 200
        crop = framing.get("faceCrop", (1150, 130, 1322, 282))
        zoom_x, zoom_y = 224 / (crop[2] - crop[0]), 152 / (crop[3] - crop[1])
        group = reference.convert("RGBA")
        overlay(group, cel)
        rendered = group.crop(crop).resize((224, 152), Image.Resampling.LANCZOS)
        marker = ImageDraw.Draw(rendered)
        for anchor, color, points in zip(LANDMARKS, marks, target):
            ax, ay = (points[0] - crop[0]) * zoom_x, (points[1] - crop[1]) * zoom_y
            px, py = measurements[name]["projectedLandmarks"][anchor]
            px, py = (px - crop[0]) * zoom_x, (py - crop[1]) * zoom_y
            marker.ellipse((ax - 2, ay - 2, ax + 2, ay + 2), outline=color)
            marker.line((px - 2, py, px + 2, py), fill=color)
        value = measurements[name]["maxDriftPx"]
        draw.text((x, y), f"{name}  max {value:.3f}px", fill="white" if value <= MAX_DRIFT else "#ff8c7f")
        sheet.paste(rendered, (x, y + 22))
    draw.text((16, 1348), "Alignment: expected marker ring, projected measured landmark cross", fill="white")
    for index, name in enumerate(HAND_NAMES):
        shot = compose(stage, parts, hands, faces, hand=f"hands/{name}")
        shot = shot.crop(framing.get("handCrop", (854, 100, 1485, 680)))
        shot.thumbnail((340, 310))
        x = index * 360 + 8
        draw.text((x, 1380), name, fill="white")
        sheet.paste(shot, (x, 1400))
    sheet.save(path)


def main():
    parser = ArgumentParser(description=__doc__)
    for path in ("source", "placement", "reference", "evidence"):
        parser.add_argument("--" + path, required=True, type=Path)
    parser.add_argument("--output", type=Path, help="Asset directory (defaults to the placement's bundled Claude skin)")
    arg = parser.parse_args()
    setup = read_json(arg.placement)
    scene = setup.get("scene", "paper")
    if scene not in ("paper", "lamp", "autumn"):
        raise ValueError(f"Unknown Claude scene: {scene}")
    output = arg.output or OUTPUT_ROOT / f"claude-{scene}"
    reference_sha = digest(arg.reference)
    if scene != "paper" and setup.get("referenceSha256") != reference_sha:
        raise ValueError(f"Reference hash does not match the calibrated {scene} placement")
    sources = SourceImages(arg.source)
    with Image.open(arg.reference) as original:
        reference = original.convert("RGB")
    if reference.size != STAGE:
        raise ValueError(f"Reference must be {STAGE}, found {reference.size}")
    stage, stage_mask, stage_stats = stage_from_source(sources, setup["stage"], reference)
    parts, hands, fields, faces, removed, observations = {}, {}, {}, {}, {}, {}
    for name in PARTS:
        parts[name], removed[name] = prep_part(sources, setup["parts"][name])
    if "inkPen" in setup:
        parts["ink_pen"], removed["ink_pen"] = prep_part(sources, setup["inkPen"]["part"])
    parts["cape_join"], removed["cape_join"] = prep_part(sources, setup["armMesh"]["capeJoin"])
    arm_mesh, arm_check = correspondence(
        [setup["hands"][name] for name in HAND_NAMES], setup["armMesh"]["attachment"]
    )
    prepared_hands = []
    for name in HAND_NAMES:
        cel, removed[f"hands/{name}"] = prep_part(sources, setup["hands"][name])
        prepared_hands.append(cel)
    hand_keys = [f"hands/{name}" for name in HAND_NAMES]
    for index, (key, cel) in enumerate(zip(hand_keys, shared_rect(prepared_hands))):
        matte = None if index else polygon_mask(cel.image.size, setup["armMesh"]["restBackdrop"], cel.rect[:2]) == 0
        field, count = distance_texture(cel.image, matte)
        fields[key] = Cel(field, cel.rect)
        artwork = preview_pose(field, cel.rect, arm_mesh["source"][index], arm_mesh["stage"][index])
        hands[key] = Cel(artwork, cel.rect)
        arm_check.setdefault("sourceCoveragePixels", {})[key] = count
    target = face_landmarks(setup["face"]["target"], STAGE)
    for group, names in FACE_GROUPS.items():
        spec = setup["face"][group]
        rect = spec["rect"]
        mask = polygon_mask(rect[2:], spec["polygon"], rect[:2], spec.get("feather", 5))
        template_spec = spec["frames"][names[0]]
        template = file_crop(sources.get(template_spec["file"]), template_spec.get("crop"))
        tracking = (template, face_landmarks(template_spec["landmarks"], template.size), spec.get("trackingOffsets", {}))
        for name in names:
            key = f"{group}/{name}"
            try:
                faces[key], observations[key] = bake_face(sources, spec["frames"][name], target, rect, mask, tracking)
            except ValueError as error:
                raise ValueError(f"{key}: {error}") from error

    packed_parts, part_uv = pack_atlas({**parts, **fields})
    packed_face, face_uv = pack_atlas(faces)
    rig = {"version": 2, "stage": STAGE, "focusX": 0.8, "eyes": setup["face"]["pupils"],
           "bones": {k: {"pivot": setup["pivots"][k], "parent": setup.get("parents", {}).get(k, p), "depth": d}
                     for k, (p, d) in BONE_ORDER.items()},
           "parts": {name: {"rect": parts[name].rect, "atlas": part_uv[name]} for name in PARTS},
           "hands": {"rect": hands["hands/idle"].rect, "frames": [part_uv[key] for key in hand_keys]},
           "armCape": {"rect": parts["cape_join"].rect, "atlas": part_uv["cape_join"]},
           "armMesh": {**arm_mesh, "distanceRange": DISTANCE_RANGE, "fingerRoundingPx": setup["armMesh"]["fingerRoundingPx"]}}
    if scene != "paper":
        rig["scene"] = scene
    if scene == "lamp":
        rig["lamp"] = setup["lamp"]
    if "inkPen" in setup:
        rig["inkPen"] = {
            "sprite": {"rect": parts["ink_pen"].rect, "atlas": part_uv["ink_pen"]},
            "grip": setup["inkPen"]["grip"],
            "handGrip": setup["inkPen"]["handGrip"],
        }
    for group, names in FACE_GROUPS.items():
        rig[group] = {"rect": faces[f"{group}/{names[0]}"].rect, "frames": [face_uv[f"{group}/{name}"] for name in names]}
    package = {"stage.webp": webp(stage, lossless=True), "parts-atlas.webp": webp(packed_parts),
               "face-atlas.webp": webp(packed_face), "rig.json": (json.dumps(rig, indent=2) + "\n").encode()}
    with Image.open(BytesIO(package["stage.webp"])) as encoded_stage:
        original_rgb = np.asarray(reference, dtype=np.int16)
        stage_delta = np.abs(np.asarray(encoded_stage, dtype=np.int16) - original_rgb)
        stage_stats.update({
            "maxChangeOutsideMask": int(stage_delta[stage_mask == 0].max()),
            "meanChangeOutsideMask": float(stage_delta[stage_mask == 0].mean()),
        })
        rest_rgb = np.asarray(compose(stage, parts, hands, faces).convert("RGB"), dtype=np.int16)
        stage_stats["restPoseMeanDifference"] = float(np.abs(rest_rgb - original_rgb)[stage_mask > 0.5].mean())
    measurements = {"outputDirectory": str(output.resolve()),
                    "referenceSha256": reference_sha, "placementSha256": digest(arg.placement),
                    "sourceSha256": sources.hashes, "stage": stage_stats, "removedAlphaPixels": removed,
                    "targetLandmarks": setup["face"]["target"], "faces": observations, "armMesh": arm_check,
                    "maxDriftPx": max(report["maxDriftPx"] for report in observations.values()),
                    "bytes": {name: len(contents) for name, contents in package.items()},
                    "totalBytes": sum(map(len, package.values()))}
    arg.evidence.mkdir(parents=True, exist_ok=True)
    contact_sheet(arg.evidence / "contact-sheet.png", reference, stage, parts, hands, faces, target, observations,
                  scene, setup.get("framing", {}))
    (arg.evidence / "bake-report.json").write_text(json.dumps(measurements, indent=2) + "\n", encoding="utf-8")
    print(f"Landmark drift {measurements['maxDriftPx']:.5f}px, assets {measurements['totalBytes']} bytes")
    if measurements["maxDriftPx"] > MAX_DRIFT or measurements["totalBytes"] > BUDGET:
        raise SystemExit("Alignment or size exceeds the asset budget")
    output.mkdir(parents=True, exist_ok=True)
    for name, contents in package.items():
        (output / name).write_bytes(contents)


if __name__ == "__main__":
    main()
