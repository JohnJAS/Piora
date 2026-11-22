"""Render Qingxi's clockwise pivot and her curtsy as straight-alpha 60 fps PNGs.

    python render.py --output FRAMES --rife RIFE_EXECUTABLE --model RIFE_V4_6_DIR

Requires numpy, OpenCV, and the same RIFE v4.6 authoring tool as gait.py.
Source poses have their own front, profiles, rear, hand grips and bent legs.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import cv2 as cv
import numpy as np
from scipy.interpolate import PchipInterpolator

ASSETS = Path(__file__).resolve().parent
sys.path.insert(0, str(ASSETS.parent))
from gait import read_art, straight

ROOT = ASSETS.parents[3]
W, H, FPS = 384, 512, 60
Y, X = np.mgrid[:H, :W].astype(np.float32)
ANCHOR = (151, 483)
# In BGR order, matching the cool daylight in the final terrace shot.
MATTE = np.float32([184, 175, 165])
CANONICAL = [0, 18, 107, 190, 246, 350, 429, 483, 511]
# Crown, chin, waistband, hand grips, petticoat, lower calves.
# Register these before optical interpolation; restore the *painted* heights
# afterwards, so the crouched face and two hands travel without double images.
ROW_PINS = {
    "entry": [15, 109, 189, 250, 349, 429],
    "turn": [14, 105, 188, 257, 350, 429],
    "c0": [16, 107, 189, 255, 349, 429],
    "c1": [17, 108, 191, 250, 350, 429],
    "c2": [27, 120, 197, 225, 352, 429],
    "c3": [48, 145, 213, 236, 368, 430],
    "low": [81, 175, 242, 260, 378, 431],
    "c4": [121, 217, 262, 279, 410, 439],
    "c5": [49, 144, 213, 239, 365, 430],
    "c6": [18, 110, 190, 242, 350, 429],
    "c7": [16, 108, 189, 255, 349, 429],
}
# The supporting hip passes through a small counterwind before turning left.
# The drawn face holds the audience beyond the first profile and spots it
# again while the shoulders are still in the last profile.
TIMING = [
    (0, "entry"), (11, "t1"), (20, "t0"),
    (24, "a0"), (28, "a1"), (32, "a2"), (36, "a3"), (40, "p0"),
    (45, "s0"), (48, "a4"), (49, "g0"), (50, "g1"), (51, "g2"), (52, "a5"),
    (53, "g3"), (54, "g4"), (55, "g5"), (56, "a6"), (60, "a7"),
    (64, "s1"), (68, "p1"), (72, "s2"), (76, "p2"), (80, "s3"),
    (84, "p3"), (88, "s4"), (92, "p4"), (96, "s5"), (100, "p5"),
    (104, "s6"), (109, "p6"), (115, "s7"), (128, "p7"), (139, "t0"),
    (148, "c0"), (164, "c1"), (182, "c2"), (199, "c3"), (215, "low"),
    (233, "c4"), (245, "c4"), (262, "low"), (278, "c5"), (296, "c6"),
    (314, "c7"), (330, "t0"),
]



def smooth(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def key_art():
    art = {"entry": straight(read_art()[7]["all"])}
    sheets = (
        ("turn", "t", 4),
        ("pirouette", "s", 4),
        ("pirouette-inbetweens", "p", 4),
        ("port-de-bras", "a", 4),
        ("gathered-arm-passes", "g", 3),
        ("curtsy", "c", 4),
    )
    for name, prefix, columns in sheets:
        sheet = cv.imread(str(ASSETS / f"{name}.webp"), cv.IMREAD_UNCHANGED)
        if sheet is None or sheet.shape != (H * 2, W * columns, 4):
            raise ValueError(f"Invalid alpha pose sheet: {name}")
        for i in range(columns * 2):
            y, x = i // columns * H, i % columns * W
            art[prefix + str(i)] = sheet[y : y + H, x : x + W].copy()
    art["low"] = cv.imread(str(ASSETS / "bow.webp"), cv.IMREAD_UNCHANGED)
    return art


def landmarks(name):
    rows = ROW_PINS["turn" if name[0] in ("t", "s", "p", "a", "g") else name]
    return np.float32([0, *rows, 483, 511])


def remap_alpha(frame, mapx, mapy):
    # OpenCV interpolation is premultiplied; dark transparent image borders
    # never bleed into the fine hair, fingers or shoes.
    x = frame.astype(np.float32) / 255
    x[:, :, :3] *= x[:, :, 3:]
    sample = cv.remap(x, mapx.astype(np.float32), mapy.astype(np.float32), cv.INTER_LINEAR)
    return straight(sample)


REAR_LEG = {
    "low": (
        [
            (150, 360),
            (156, 364),
            (161, 368),
            (170, 375),
            (174, 381),
            (177, 388),
            (179, 400),
            (181, 406),
            (188, 412),
            (200, 418),
            (202, 465),
            (170, 465),
            (165, 458),
            (166, 451),
            (170, 443),
            (170, 428),
            (165, 416),
            (158, 405),
            (155, 384),
            (153, 368),
        ],
        [(155, 377), (177, 422), (172, 461)],
        390,
    ),
    "c4": (
        [
            (147, 376),
            (139, 377),
            (132, 382),
            (124, 388),
            (116, 395),
            (108, 405),
            (102, 410),
            (94, 416),
            (90, 426),
            (92, 439),
            (96, 458),
            (103, 471),
            (130, 471),
            (129, 458),
            (119, 442),
            (117, 432),
            (122, 427),
            (131, 422),
            (140, 419),
            (141, 410),
            (144, 398),
            (148, 386),
        ],
        [(143, 387), (105, 430), (118, 467)],
        416,
    ),
}


def rear_parts(frame, name):
    outline, _, hem = REAR_LEG[name]
    mask = np.zeros((H * 4, W * 4), np.uint8)
    cv.fillPoly(mask, [4 * np.int32(outline)], 255, cv.LINE_AA)
    mask = cv.resize(mask, (W, H), interpolation=cv.INTER_AREA)
    rear = frame.copy()
    rear[:, :, 3] = np.rint(frame[:, :, 3].astype(float) * mask / 255).astype(np.uint8)
    body = frame.copy()
    body[:, :, 3] = np.rint(frame[:, :, 3] * (1 - mask.astype(float) / 255)).astype(np.uint8)
    # Extend the back petticoat across the original occluded thigh so that
    # the independently crossing rear shoe can pass behind the support leg.
    hole = np.uint8((mask > 0) & (Y < hem))
    repaired = cv.inpaint(body[:, :, :3].copy(), hole, 5, cv.INPAINT_TELEA)
    restore = np.clip((hem - Y) / 5, 0, 1) * hole
    body[:, :, :3] = np.uint8(
        np.rint(body[:, :, :3] * (1 - restore[:, :, None]) + repaired * restore[:, :, None])
    )
    body[:, :, 3] = np.uint8(np.maximum(body[:, :, 3], np.rint(255 * restore)))
    return body, rear


def placed_leg(frame, source, target):
    maps = []
    for j in range(2):
        a, b = source[j : j + 2]
        c, d = target[j : j + 2]
        s = b - a
        u = d - c
        length = np.linalg.norm(u)
        axis = u / length
        normal = np.array([-axis[1], axis[0]])
        v = s / np.linalg.norm(s)
        n = np.array([-v[1], v[0]])
        px = X - c[0]
        py = Y - c[1]
        along = (px * axis[0] + py * axis[1]) * np.linalg.norm(s) / length
        across = px * normal[0] + py * normal[1]
        maps.append((a[0] + along * v[0] + across * n[0], a[1] + along * v[1] + across * n[1]))
    ankle = smooth((Y - target[1, 1] + 5) / 10)
    return remap_alpha(
        frame,
        maps[0][0] * (1 - ankle) + maps[1][0] * ankle,
        maps[0][1] * (1 - ankle) + maps[1][1] * ankle,
    )


def crossing_shoe(body, art, left, right, t):
    src0 = np.float32(REAR_LEG[left][1])
    src1 = np.float32(REAR_LEG[right][1])
    joints = src0 * (1 - t) + src1 * t
    joints[1:, 1] -= 5 * np.sin(t * np.pi)
    a = placed_leg(art[left + "-rear"], src0, joints).astype(np.float32) / 255
    b = placed_leg(art[right + "-rear"], src1, joints).astype(np.float32) / 255

    def distance(alpha):
        on = np.uint8(alpha > 0.4)
        return cv.distanceTransform(on, cv.DIST_L2, 3) - cv.distanceTransform(1 - on, cv.DIST_L2, 3)

    coverage = np.clip((1 - t) * distance(a[:, :, 3]) + t * distance(b[:, :, 3]) + 0.5, 0, 1)
    weight = a[:, :, 3] * (1 - t) + b[:, :, 3] * t
    colors = (a[:, :, :3] * a[:, :, 3:] * (1 - t) + b[:, :, :3] * b[:, :, 3:] * t) / np.maximum(
        weight[:, :, None], 0.001
    )
    fg = body.astype(np.float32) / 255
    alpha = fg[:, :, 3]
    out_alpha = alpha + coverage * (1 - alpha)
    premul = fg[:, :, :3] * alpha[:, :, None] + colors * (coverage * (1 - alpha))[:, :, None]
    return straight(np.dstack((premul, out_alpha)))


def prepare_track(art, folder, rife, model):
    # Each output lies exactly j/steps between its own two surrounding keys.
    # Group equal durations to avoid repeatedly loading the optical model.
    groups = {}
    for (a, left), (b, right) in zip(TIMING, TIMING[1:]):
        if left != right and b - a > 1:
            groups.setdefault(b - a, []).append((a, left, right))

    variants = {}
    samples = {}
    for steps, pairs in groups.items():
        inputs = folder / f"keys-{steps}"
        outputs = folder / f"samples-{steps}"
        inputs.mkdir()
        outputs.mkdir()
        route = []
        for start, left, right in pairs:
            separate = {left, right} == {"low", "c4"}
            left_key = left + "-body" if separate else left
            right_key = right + "-body" if separate else right
            if not route or route[-1] != (left_key, left):
                route.append((left_key, left))
            offset = (len(route) - 1) * steps
            for j in range(1, steps):
                # NCNN labels its first output 0001 (the first key itself).
                samples[start + j] = outputs / f"{offset + j + 1:04}.png"
            route.append((right_key, right))
        for i, (key, pose) in enumerate(route):
            if key not in variants:
                mapy = np.interp(Y, CANONICAL, landmarks(pose)).astype(np.float32)
                cel = remap_alpha(art[key], X, mapy).astype(np.float32)
                alpha = cel[:, :, 3:] / 255
                rgb = cel[:, :, :3] * alpha + MATTE * (1 - alpha)
                variants[key] = np.uint8(np.rint(np.concatenate(
                    (rgb, np.zeros((H, 32, 3), np.float32), np.repeat(255 * alpha, 3, axis=2)),
                    axis=1,
                )))
            if not cv.imwrite(str(inputs / f"{i:03}.png"), variants[key]):
                raise OSError(inputs)
        subprocess.run([
            str(rife), "-i", str(inputs), "-o", str(outputs), "-m", str(model),
            "-n", str(len(route) * steps), "-j", "2:1:2", "-f", "%04d.png",
        ], check=True)
    if any(not path.is_file() for path in samples.values()):
        raise ValueError("Missing 60 fps optical samples")
    return samples


def unmatte(path):
    img = cv.imread(str(path)).astype(np.float32)
    colour = img[:, :W]
    predicted = img[:, W + 32 :, 1] / 255
    background = np.max(np.abs(colour - MATTE), axis=2)
    # A neutral, cool matte agrees with the terrace's existing daylight.
    # Preserve highlights and use the colour pass to veto empty-space noise.
    # Opaque paint that happens to match the matte stays opaque.
    core = smooth((predicted - 0.94) / 0.055)
    alpha = predicted * np.maximum(core, smooth((background - 2) / 9))
    fg = np.clip(
        (colour - MATTE * (1 - alpha[:, :, None])) / np.maximum(alpha[:, :, None], 0.001), 0, 255
    )
    a = np.uint8(np.rint(255 * alpha))
    count, cc, stats, _ = cv.connectedComponentsWithStats(np.uint8(a > 55))
    if count > 1:
        region = cv.dilate(np.uint8(cc == np.argmax(stats[1:, 4]) + 1), np.ones((5, 5), np.uint8))
        a *= region
    rgba = np.dstack((np.uint8(np.rint(fg)), a))
    rgba[a < 3] = 0
    return rgba


# Artist's timing for the weight transfer, demi-plié and release. The
# supporting sole stays on its mark while the hip changes depth. Values
# are in canonical cel pixels and degrees, before stage projection.
TURN_MOTION = PchipInterpolator(
    [0, 16, 40, 45, 65, 84, 102, 115, 124, 134, 145],
    np.float32([
        [0, 0, 0, 0, 0], [-1, 1.2, .45, -1, 0],
        [-3, 5.3, 1.15, -1.7, .3], [-4.5, 7.3, 1.5, -2, 1],
        [1, -1.2, -.36, 4, 3], [2.6, -3, -.6, 7.5, 6.8],
        [1.6, -2, -.4, -6.3, 6.5], [1, 1.3, .18, -7.2, 4.8],
        [-1.1, 2.6, .38, -4, 1.8], [.55, -.5, -.18, 2.2, -.7],
        [0, 0, 0, 0, 0],
    ]), axis=0,
)


def secondary(frame, number):
    if number <= 0 or number >= 145:
        return frame
    shift, dip, tilt, hair_lag, flare = TURN_MOTION(number)
    # Rotate the head, shoulder and both hands together about the support
    # foot. A small change of knee flexion takes the body's vertical shift.
    upper = smooth((483 - Y) / 164)
    angle = np.deg2rad(tilt)
    px, py = X - ANCHOR[0], Y - ANCHOR[1]
    mapx = ANCHOR[0] + np.cos(angle)*px + np.sin(angle)*py - shift * upper
    mapy = ANCHOR[1] - np.sin(angle)*px + np.cos(angle)*py - dip * upper
    # Only the loose outer curls and the lower fabric continue past zero
    # after the stop. Keep the face and the bent arms out of both fields.
    radial = smooth((np.abs(px) - 49) / 68)
    locks = radial * smooth((Y - 77) / 54) * (1 - smooth((Y - 158) / 38))
    hem = radial * smooth((Y - 266) / 44) * (1 - smooth((Y - 340) / 12))
    mapx -= locks * hair_lag + np.sign(px) * hem * flare
    mapy += hem * abs(flare) * .25
    return remap_alpha(frame, mapx, mapy)


# A reverence has a moving low point. The head continues its nod as the
# weight settles, the pinched skirt catches up, then the gaze leads the rise.
BOW_FOLLOW = PchipInterpolator(
    [139, 160, 182, 199, 215, 233, 240, 245, 262, 278, 296, 314, 330],
    np.float32([
        [0, 0, 0], [-.4, -.8, .4], [.5, -1.2, -1.5], [1.1, 1.1, 1.3],
        [.5, 2.1, 2.3], [-.5, 1.1, .3], [-1.2, 3.6, 1.7],
        [-.9, 2.2, 2.9], [-.3, -1.7, .7], [.6, -2.4, -1.7],
        [.95, -.8, -1.2], [-.4, .9, .65], [0, 0, 0],
    ]), axis=0,
)


def bow_follow(frame, number, rows):
    if number <= 139 or number >= TIMING[-1][0]:
        return frame
    shift, head_dip, cuff_dip = BOW_FOLLOW(number)
    _, _, chin, waist, grips, hem, *_ = rows
    # The head and face move as one. Distribute its nod through the neck
    # and chest, and carry each cuff and its pinched fold together.
    head = 1 - smooth((Y - chin) / (waist - chin))
    side = smooth((np.abs(X - 153) - 28) / 63)
    fabric = side * np.exp(-((Y - grips) / 60) ** 2)
    loose_hem = side * np.exp(-((Y - hem) / 33) ** 2)
    mapx = X - shift * head - .38 * np.sign(X - 153) * cuff_dip * fabric
    mapy = Y - head * head_dip - cuff_dip * (fabric + .42 * loose_hem)
    return remap_alpha(frame, mapx, mapy)


def render(output, rife, model):
    output.mkdir(parents=True, exist_ok=True)
    art = key_art()
    for name in REAR_LEG:
        art[name + "-body"], art[name + "-rear"] = rear_parts(art[name], name)
    with TemporaryDirectory() as tmp:
        samples = prepare_track(art, Path(tmp), rife, model)
        for (a, left), (b, right) in zip(TIMING, TIMING[1:]):
            for number in range(a, b):
                t = (number - a) / (b - a)
                rows = landmarks(left) * (1 - t) + landmarks(right) * t
                if number == a or left == right:
                    frame = art[left]
                else:
                    cell = unmatte(samples[number])
                    mapy = np.interp(Y, rows, CANONICAL).astype(np.float32)
                    frame = remap_alpha(cell, X, mapy)
                    if {left, right} == {"low", "c4"}:
                        frame = crossing_shoe(frame, art, left, right, t)
                frame = bow_follow(secondary(frame, number), number, rows)
                if not cv.imwrite(str(output / f"{number:04}.png"), frame, [cv.IMWRITE_PNG_COMPRESSION, 3]):
                    raise OSError(output)
    last = TIMING[-1][0]
    if not cv.imwrite(str(output / f"{last:04}.png"), art["t0"], [cv.IMWRITE_PNG_COMPRESSION, 3]):
        raise OSError(output)
    timeline = {
        "fps": FPS,
        "canvas": [W, H],
        "anchor": ANCHOR,
        "frames": last + 1,
        "front": 20,
        "anticipation": 45,
        "leftProfile": 72,
        "back": 88,
        "rightProfile": 104,
        "completeTurn": 115,
        "settled": 145,
        "bothHandsRaiseSkirt": 182,
        "deepestCurtsy": [233, 245],
        "lowestNod": 240,
        "releasedSkirt": 314,
        "entryAndExit": [0, last],
        "entryAndExitPaintings": ["gait 07", "turn 00"],
        "keys": dict(TIMING),
    }
    (output / "timeline.json").write_text(json.dumps(timeline, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("--output", type=Path, required=True)
    default_rife = ROOT / ".verification/wallpaper-walk/rife"
    arguments.add_argument("--rife", type=Path, default=default_rife / "rife-ncnn-vulkan.exe")
    arguments.add_argument("--model", type=Path, default=default_rife / "rife-v4.6")
    args = arguments.parse_args()
    render(args.output, args.rife.resolve(), args.model.resolve())
