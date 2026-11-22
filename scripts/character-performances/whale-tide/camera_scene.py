"""Composite the Morning Tide actor at 1080p in the original terrace framing."""
from functools import lru_cache
from pathlib import Path

import cv2 as cv
import numpy as np
from camera_detail import MATTE, magnify, uint

HERE = Path(__file__).resolve().parent
ART = HERE / "camera"
ORIGINAL = HERE.parents[2] / "public/themes/character-backgrounds/whale-tide.webp"
W, H = 1920, 1080
# Paths and floor contacts stay in the original 1536-wide authoring space.
START, GROUND, SCALE = 1194, 1220, 2.56
OUTPUT_SCALE = W / 1536
CUP_SCALE = SCALE / 1.31
CUP_ORIGIN = (START - 237 * CUP_SCALE, GROUND - 646 * CUP_SCALE)
GESTURE_LEFT = 790  # Includes the whaletail and the original edge corrections.


def _read(path, flags=cv.IMREAD_COLOR):
    image = cv.imread(str(path), flags)
    if image is None:
        raise FileNotFoundError(path)
    return image


@lru_cache(maxsize=1)
def _plate():
    background = cv.resize(_read(ORIGINAL), (W, H), interpolation=cv.INTER_CUBIC)
    background[:, 850:] = _read(ART / "stage-repair.webp")
    return background


def stage():
    return _plate().copy()


@lru_cache(maxsize=1)
def _rest():
    frame = np.zeros((H, W, 4), np.uint8)
    frame[:, 850:] = _read(ART / "native-pose.webp", cv.IMREAD_UNCHANGED)
    return frame


@lru_cache(maxsize=1)
def _front_table():
    mask = np.full((H, W), 255, np.uint8)
    rim = np.float32([(1304,864),(1333,755),(1340,746),(1353,756),(1374,765),
                      (1402,775),(1440,784),(1492,792),(1536,796),(1536,864)])
    cv.fillPoly(mask, [np.int32(np.rint(rim * OUTPUT_SCALE * 16))], 0, cv.LINE_AA, shift=4)
    return mask


def _premul(cel):
    return np.dstack((uint(cel[:, :, :3] * (cel[:, :, 3:4].astype(np.float32) / 255)), cel[:, :, 3]))


def _straight(paint):
    a = paint[:, :, 3:4].astype(np.float32)
    return np.dstack((uint(paint[:, :, :3] * (255 / np.maximum(a, .1))), paint[:, :, 3]))


def _place(paint, scale, x, y, occlude=True):
    """Map premultiplied paint to the output once, retaining the fractional root."""
    left, top = max(0, int(np.floor(x))), max(0, int(np.floor(y)))
    right = min(W, int(np.ceil(x + paint.shape[1] * scale)))
    bottom = min(H, int(np.ceil(y + paint.shape[0] * scale)))
    result = np.zeros((H, W, 4), np.uint8)
    if right <= left or bottom <= top:
        return result
    matrix = np.float32([[scale, 0, x - left + (scale - 1) / 2],
                         [0, scale, y - top + (scale - 1) / 2]])
    cut = _straight(cv.warpAffine(paint, matrix, (right-left, bottom-top), flags=cv.INTER_CUBIC))
    if occlude:
        cut[:, :, 3] = uint(cut[:, :, 3].astype(np.float32) * (_front_table()[top:bottom, left:right] / 255))
    result[top:bottom, left:right] = cut
    return result


@lru_cache(maxsize=1)
def _table_cup():
    source = _read(ART / "cup.webp", cv.IMREAD_UNCHANGED)
    scale = CUP_SCALE * OUTPUT_SCALE
    x = (CUP_ORIGIN[0] + 319 * CUP_SCALE) * OUTPUT_SCALE
    y = (CUP_ORIGIN[1] + 392 * CUP_SCALE) * OUTPUT_SCALE
    layer = _place(magnify(source), scale / 2, x, y, occlude=False)
    xx, yy, w, h = cv.boundingRect(layer[:, :, 3])
    return xx, yy, layer[yy:yy+h, xx:xx+w].copy()


def foreground(actor_bgra, ground_x, anchor=(151, 483)):
    """Place one straight-alpha canonical gait/turn cel in 1536-space coordinates."""
    if actor_bgra.ndim != 3 or actor_bgra.shape[2] != 4 or actor_bgra.dtype != np.uint8:
        raise ValueError("Expected a straight-alpha uint8 BGRA cel")
    source_ratio = actor_bgra.shape[1] / 384
    x = (ground_x - anchor[0] * SCALE) * OUTPUT_SCALE
    y = (GROUND - anchor[1] * SCALE) * OUTPUT_SCALE
    scale = SCALE * OUTPUT_SCALE / source_ratio
    bottom = max(1, int(np.ceil((H - y) / scale)) + 4)
    sample = actor_bgra[:bottom]
    paint = magnify(sample, canonical=(source_ratio == 1)) if source_ratio < 2 else _premul(sample)
    actor = _place(paint, scale / (2 if source_ratio < 2 else 1), x, y)
    cx, cy, cup = _table_cup()
    roi = actor[cy:cy+cup.shape[0], cx:cx+cup.shape[1]]
    a, b = cup[:, :, 3:4].astype(np.float32) / 255, roi[:, :, 3:4].astype(np.float32) / 255
    both = a + b * (1 - a)
    roi[:, :, :3] = uint((cup[:, :, :3]*a + roi[:, :, :3]*b*(1-a)) / np.maximum(both, .001))
    roi[:, :, 3] = uint(both[:, :, 0]*255)
    return actor


@lru_cache(maxsize=1)
def _standing():
    return foreground(_read(ART / "standing.webp", cv.IMREAD_UNCHANGED), START)


def _over(fg):
    alpha = fg[:, :, 3:4].astype(np.float32) / 255
    return uint(_plate() * (1 - alpha) + fg[:, :, :3] * alpha)


def composite(actor_bgra, ground_x, anchor=(151,483)):
    return _over(foreground(actor_bgra, ground_x, anchor))


@lru_cache(maxsize=1)
def _cup_cels():
    # These source pictures have neural line reconstruction at twice their
    # original drawing resolution. Neutral-matted color and coverage share
    # a lossless geometry, including the spaces between her fingers.
    cap = cv.VideoCapture(str(ART / "cup-hd.mp4"))
    cels = []
    try:
        while True:
            ok, packed = cap.read()
            if not ok:
                break
            a = packed[:, 1016:, 1:2].astype(np.float32)
            pre = np.clip(packed[:, :1000] - MATTE * (1 - a / 255), 0, a)
            cels.append(uint(np.concatenate((pre, a), axis=2)))
    finally:
        cap.release()
    if len(cels) != 53:
        raise ValueError("Expected 53 prepared cup key drawings")
    return cels


def _registered_head(frame, index):
    if not 0 < index < 12:
        return
    s = np.interp(index, [0,3,7,11], [1,.981,.953,.926])
    r = np.interp(index, [0,3,7,11], [0,.006,.009,.018])
    x = np.interp(index, [0,3,7,11], [0,4.194,11.828,17.915]) * OUTPUT_SCALE
    y = np.interp(index, [0,3,7,11], [0,4.437,8.468,13.274]) * OUTPUT_SCALE
    left, right, bottom = (round(n*OUTPUT_SCALE) for n in (910,1490,260))
    patch = frame[:bottom, left:right]
    native = _premul(_rest()[:bottom,left:right])
    aligned = cv.warpAffine(native, np.float32([[s,r,x],[-r,s,y]]), (right-left, bottom))
    paint = _premul(patch)
    t = np.clip((12-index)/7, 0, 1)
    edge = np.clip((256 - np.arange(bottom, dtype=np.float32) / OUTPUT_SCALE) / 31, 0, 1)
    w = np.float32(edge * t*t*(3-2*t))[:,None,None]
    if 0 < t < 1:
        grid = _grid(bottom, right-left)
        flow = _solve(paint, aligned, .55)
        paint = cv.remap(paint, grid-w*flow, None, cv.INTER_LINEAR)
        aligned = cv.remap(aligned, grid+(1-w)*flow, None, cv.INTER_LINEAR)
    patch[:] = _straight(uint(paint*(1-w) + aligned*w))


@lru_cache(maxsize=5)
def _key(index):
    if index == 0:
        frame = _rest()
    elif index == 52:
        frame = _standing()
    else:
        frame = _place(_cup_cels()[index], CUP_SCALE * OUTPUT_SCALE / 2,
                       CUP_ORIGIN[0] * OUTPUT_SCALE, CUP_ORIGIN[1] * OUTPUT_SCALE)
        _registered_head(frame, index)
    return _premul(frame[:, GESTURE_LEFT:])


@lru_cache(maxsize=2)
def _grid(h, w):
    yy, xx = np.indices((h, w), np.float32)
    return np.stack((xx, yy), axis=2)


def _solve(first, second, scale):
    def gray(p):
        # Use a contrasting neutral background to track silhouette and
        # ink together, including the changing negative space at the wrists.
        small = cv.resize(p, None, fx=scale, fy=scale, interpolation=cv.INTER_AREA)
        return cv.cvtColor(uint(small[:,:,:3] + (255-small[:,:,3:4])*.72), cv.COLOR_BGR2GRAY)
    solver = cv.DISOpticalFlow_create(cv.DISOPTICAL_FLOW_PRESET_MEDIUM)
    flow = solver.calc(gray(first), gray(second), None)
    return cv.resize(flow, (first.shape[1], first.shape[0]), interpolation=cv.INTER_LINEAR) / scale


@lru_cache(maxsize=3)
def _flows(index):
    first, second = _key(index), _key(index + 1)
    return _solve(first, second, .40), _solve(second, first, .40)


def gesture_foreground(progress):
    """Continuously sample corresponding strokes in both directions at the requested time."""
    p = float(np.clip(progress, 0, 1))
    if p == 0:
        return _rest().copy()
    if p == 1:
        return _standing().copy()
    pos = float(np.interp(p, [0,.28,.55,.64,.82,1], [0,13,25,27,39,52]))
    index = min(int(pos), 51)
    t = pos-index
    first, second = _key(index), _key(index+1)
    fwd, back = _flows(index)
    grid = _grid(first.shape[0], first.shape[1])
    left = cv.remap(first, grid-t*fwd, None, cv.INTER_LINEAR)
    right = cv.remap(second, grid-(1-t)*back, None, cv.INTER_LINEAR)
    frame = np.zeros((H, W, 4), np.uint8)
    frame[:, GESTURE_LEFT:] = _straight(cv.addWeighted(left, 1-t, right, t, 0))
    return frame


def camera_frame(progress):
    return _over(gesture_foreground(progress))
