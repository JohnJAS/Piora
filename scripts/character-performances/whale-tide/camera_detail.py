"""Offline line reconstruction for the terrace actor, in straight BGRA."""
from functools import lru_cache
from pathlib import Path

import cv2 as cv
import numpy as np

ART = Path(__file__).resolve().parent / "camera"
MATTE = np.float32([195, 182, 173])


def uint(image):
    return np.uint8(np.rint(np.clip(image, 0, 255)))


@lru_cache(maxsize=1)
def _network():
    return cv.dnn.readNetFromONNX(str(ART / "anime-detail.onnx"))


def _reconstruct(image):
    """Learned subpixel luma residual from the Anime4K x2 Medium network."""
    model = _network()
    model.setInput(cv.dnn.blobFromImage(image, 1 / 255, swapRB=True))
    h, w = image.shape[:2]
    offsets = model.forward()[0].reshape(2, 2, h, w)
    offsets = offsets.transpose(2, 0, 3, 1).reshape(2 * h, 2 * w)
    base = cv.resize(image, (2 * w, 2 * h), interpolation=cv.INTER_LINEAR)
    return uint(base + offsets[:, :, None] * 255)


def _gray(image):
    return cv.cvtColor(image, cv.COLOR_BGR2GRAY)


@lru_cache(maxsize=1)
def _references():
    # These front, side, back and bow guides contain only a band of detail
    # from the registered source paintings. The runtime never swaps a face.
    capture = cv.VideoCapture(str(ART / "ink-guides.mp4"))
    refs = []
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            source = frame[:320, :384]
            detail = frame[:, 400:, :].astype(np.int16) - 128
            patch = cv.resize(source[:230], (48, 29), interpolation=cv.INTER_AREA)
            refs.append((_gray(source), detail.astype(np.int8), patch))
    finally:
        capture.release()
    if not refs:
        raise ValueError("Missing registered ink guides")
    return refs


def _painted_detail(image, reconstructed):
    """Reproject high-frequency linework locally where a painted guide agrees."""
    if image.shape[0] < 230 or image.shape[1] != 384:
        return reconstructed
    target = image[:320]
    patch = cv.resize(target[:230], (48, 29), interpolation=cv.INTER_AREA).astype(np.float32)
    refs = _references()
    errors = np.array([np.mean(np.abs(patch - item[2])) for item in refs])
    # Two guides avoid a single nearest-pose switch at a turn in profile.
    nearest = np.argsort(errors)[:2]
    gains = np.exp(-(errors[nearest] - errors[nearest[0]]) / 1.7)
    gains /= gains.sum()
    h, w = target.shape[:2]
    gray = _gray(target)
    yy, xx = np.indices((2 * h, 2 * w), np.float32)
    grid = np.stack((xx, yy), axis=2)
    correction = np.zeros((2 * h, 2 * w, 3), np.float32)
    solver = cv.DISOpticalFlow_create(cv.DISOPTICAL_FLOW_PRESET_FAST)
    for index, gain in zip(nearest, gains):
        key, ink, _ = refs[index]
        # Registration operates on drawings at authored resolution. Warp
        # only line detail into the output; source eye color stays intact.
        flow = solver.calc(gray, key[:h], None)
        mapping = grid + 2 * cv.resize(flow, (2 * w, 2 * h))
        ref_luma = cv.remap(key[:h], (mapping[::2, ::2] / 2), None, cv.INTER_LINEAR)
        mismatch = cv.GaussianBlur(cv.absdiff(gray, ref_luma), (0, 0), 1.5)
        confidence = np.clip((26 - mismatch.astype(np.float32)) / 21, 0, 1)
        aligned = cv.remap(ink[:2 * h].astype(np.float32), mapping, None, cv.INTER_LINEAR)
        correction += aligned * cv.resize(confidence, (2 * w, 2 * h))[:, :, None] * gain
    out = reconstructed.copy()
    out[:2 * h] = uint(out[:2 * h] + correction)
    return out


def _retain_iris_paint(image, restored):
    # Preserve the painter's gradation and point highlights within the blue
    # iris. Color plus proximity to skin follows either eye as she turns.
    b, g, r = cv.split(image.astype(np.float32))
    skin = np.uint8((r > g + 5) & (r > b + 10) & (r > 138)) * 255
    near_skin = cv.dilate(skin, cv.getStructuringElement(cv.MORPH_ELLIPSE, (13, 13)))
    pigment = np.clip((b - r - 2) / 12, 0, 1) * np.clip((b - g + 1) / 10, 0, 1)
    iris = cv.GaussianBlur(pigment * (near_skin / 255).astype(np.float32), (0,0), .65)
    iris = cv.resize(iris, (restored.shape[1], restored.shape[0]))[:, :, None]
    original = cv.resize(image, (restored.shape[1], restored.shape[0]), interpolation=cv.INTER_LANCZOS4)
    strength = np.clip(iris * 1.2, 0, .91)
    return uint(restored * (1 - strength) + original * strength)

def magnify(cel, canonical=False):
    alpha = cel[:, :, 3:4].astype(np.float32) / 255
    matted = uint(cel[:, :, :3] * alpha + MATTE * (1 - alpha))
    restored = _reconstruct(matted)
    if canonical:
        restored = _retain_iris_paint(matted, _painted_detail(matted, restored))
    coverage = cv.resize(cel[:, :, 3], None, fx=2, fy=2, interpolation=cv.INTER_CUBIC)
    a = coverage[:, :, None].astype(np.float32) / 255
    # Return premultiplied: filtering into a transparent pixel cannot bring
    # the neutral CNN border into her hair or the gap above her fingers.
    rgb = np.clip(restored - MATTE * (1 - a), 0, a * 255)
    return uint(np.concatenate((rgb, a * 255), axis=2))
