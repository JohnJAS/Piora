"""Measure integer-pixel translation between two actual Electron screenshots.

Pick corners on the projected artwork, not on the application UI. An eroded
original/stage equality mask excludes repainted pixels and their neighborhood.
"""

from argparse import ArgumentParser
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path

import cv2
import numpy as np


ART = Path(__file__).resolve().parents[2] / "public/themes/character-backgrounds"
PATCH = 9
SEARCH = (112, 14)
MIN_MATCHES = 25


def image(path):
    pixels = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)
    if pixels is None:
        raise ValueError(f"Cannot decode {path}")
    return pixels


def gray(rgb):
    return cv2.cvtColor(rgb, cv2.COLOR_BGR2GRAY)


def project_background(skin, shape, bounds):
    original_path = ART / f"{skin}.webp"
    original = image(original_path)
    stage = image(ART / "claude-live" / skin / "stage.webp") if skin.startswith("claude-") else original
    unchanged = np.all(original == stage, axis=2).astype(np.uint8) * 255
    rows, cols = shape[:2]
    box = bounds["rect"]
    width, height = bounds["cssWidth"], bounds["cssHeight"]
    # Two-dimensional screenshot pixel centers, through the CSS scale and cover crop.
    yy, xx = np.indices((rows, cols), dtype=np.float32)
    cover = max(width / original.shape[1], height / original.shape[0])
    offset_x = (width - original.shape[1] * cover) * 0.8
    offset_y = (height - original.shape[0] * cover) * 0.5
    map_x = (((xx + 0.5 - box["x"]) * width / box["width"]) - offset_x) / cover - 0.5
    map_y = (((yy + 0.5 - box["y"]) * height / box["height"]) - offset_y) / cover - 0.5
    projected = cv2.remap(gray(original), map_x, map_y, cv2.INTER_LINEAR)
    safe = cv2.remap(unchanged, map_x, map_y, cv2.INTER_LINEAR) == 255
    # Below the title bar and inside the area where neither puppet effects
    # nor the sidebar are drawn. A second match against the static screenshot
    # checks candidate patches for overlapping text or other app chrome.
    roi = [round(cols * 0.23), round(rows * 0.10), round(cols * 0.61), round(rows * 0.72)]
    left, top, right, bottom = roi
    region = np.zeros((rows, cols), dtype=np.uint8)
    region[top:bottom, left:right] = safe[top:bottom, left:right]
    region = cv2.erode(region, np.ones((2 * PATCH + 5, 2 * PATCH + 5), dtype=np.uint8))
    return projected, region, roi, original_path


def chip(pixels, x, y):
    return pixels[y - PATCH:y + PATCH + 1, x - PATCH:x + PATCH + 1]


def best_match(pixels, template, x, y):
    rx, ry = SEARCH
    left, top = x - PATCH - rx, y - PATCH - ry
    right, bottom = x + PATCH + rx + 1, y + PATCH + ry + 1
    if left < 0 or top < 0 or right > pixels.shape[1] or bottom > pixels.shape[0]:
        return None
    correlation = cv2.matchTemplate(pixels[top:bottom, left:right], template, cv2.TM_CCOEFF_NORMED)
    _, score, _, (u, v) = cv2.minMaxLoc(correlation)
    if u in (0, correlation.shape[1] - 1) or v in (0, correlation.shape[0] - 1):
        return None
    correlation[max(0, v - 4):v + 5, max(0, u - 4):u + 5] = -1
    runner_up = float(correlation.max())
    return (int(x + u - rx), int(y + v - ry)), float(score), runner_up


def measure(skin, static, dynamic, bounds):
    a, b = image(static), image(dynamic)
    if a.shape != b.shape:
        raise ValueError("The two Electron screenshots must share one viewport")
    ref, mask, roi, original_path = project_background(skin, a.shape, bounds)
    ga, gb = gray(a), gray(b)
    corners = cv2.goodFeaturesToTrack(ref, 160, 0.012, 12, mask=mask)
    if corners is None:
        raise ValueError(f"No candidate background features for {skin}")
    features = []
    rejected = Counter()
    for x, y in np.rint(corners.reshape(-1, 2)).astype(int):
        x, y = int(x), int(y)
        template = chip(ga, x, y)
        art_score = float(cv2.matchTemplate(chip(ref, x, y), template, cv2.TM_CCOEFF_NORMED)[0, 0])
        if art_score < 0.91:
            rejected["static patch does not match painted background"] += 1
            continue
        hit = best_match(gb, template, x, y)
        if not hit or hit[1] < 0.92 or hit[1] - hit[2] < 0.009:
            rejected["forward match weak, ambiguous or outside search"] += 1
            continue
        (dx, dy), score, runner_up = hit
        reverse = best_match(ga, chip(gb, dx, dy), dx, dy)
        if not reverse or reverse[1] < 0.92 or reverse[0] != (x, y):
            rejected["reverse match did not return to source anchor"] += 1
            continue
        features.append({
            "anchor": [x, y], "target": [dx, dy], "dx": dx - x, "dy": dy - y,
            "staticArtCorrelation": art_score, "matchCorrelation": score, "nextPeakCorrelation": runner_up,
            "reverseCorrelation": reverse[1],
        })
    if not features:
        raise ValueError(f"No reproducible wallpaper features for {skin}")
    delta = np.array([(item["dx"], item["dy"]) for item in features])
    distances = np.linalg.norm(delta, axis=1)
    return {
        "skin": skin,
        "screenshots": [{"path": str(path.resolve()), "sha256": sha256(path.read_bytes()).hexdigest()}
                        for path in (static, dynamic)],
        "referenceArt": str(original_path.resolve()),
        "bounds": bounds, "roi": roi,
        "imageSize": [a.shape[1], a.shape[0]],
        "candidates": len(corners), "rejected": dict(rejected), "stableLandmarkCount": len(features),
        "medianDxDyPixels": np.median(delta, axis=0).tolist(),
        "medianShiftPixels": float(np.median(distances)), "maxShiftPixels": float(distances.max()),
        "features": features,
    }


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--expect-zero", action="store_true")
    parser.add_argument("--overlay", type=int, help="Use the same-overlay pair from the desktop scenario")
    parser.add_argument("--skin", choices=["claude-lamp", "claude-autumn"])
    args = parser.parse_args()
    directory = args.directory
    if args.overlay is not None:
        if args.skin is None:
            parser.error("--overlay requires --skin")
        previous = json.loads((directory / "static-dynamic-geometry.json").read_text(encoding="utf-8"))
        still = directory / f"overlay-{args.overlay}-static.png"
        motion = directory / f"overlay-{args.overlay}-dynamic.png"
        height, width = image(still).shape[:2]
        bounds = {"rect": previous["canvasBounds"], "cssWidth": width + 64, "cssHeight": height + 64}
        rows = [{"pair": "same-overlay", "overlay": f"{args.overlay}%", **measure(args.skin, still, motion, bounds)}]
        output = directory / "overlay-focus-check.json"
    else:
        samples = json.loads((directory / "hot-switch.json").read_text(encoding="utf-8"))
        rows = []
        for sample in samples:
            skin = sample["target"].removeprefix("character-")
            rows.append({"pair": "static-to-first", "overlay": sample["overlay"], **measure(
                skin, directory / sample["files"]["static"], directory / sample["files"]["first"], sample["bounds"])})
        rows.append({"pair": "first-paper-to-returned-paper", "overlay": samples[-1]["overlay"], **measure(
            "claude-paper", directory / samples[0]["files"]["first"], directory / samples[-1]["files"]["first"], samples[-1]["bounds"])})
        output = directory / "focus-check.json"
    output.write_text(json.dumps({"searchPixels": SEARCH, "patchWidthPixels": 2 * PATCH + 1, "pairs": rows}, indent=2) + "\n",
                      encoding="utf-8")
    for row in rows:
        print(row["skin"], row["pair"], "matches", row["stableLandmarkCount"], "median/max",
              row["medianShiftPixels"], row["maxShiftPixels"], "dx/dy", row["medianDxDyPixels"])
    if any(row["stableLandmarkCount"] < MIN_MATCHES for row in rows):
        raise SystemExit(f"At least {MIN_MATCHES} unambiguous background matches are required per pair")
    if args.expect_zero and any(row["maxShiftPixels"] > 0 for row in rows):
        raise SystemExit("An actual wallpaper transition moves a stable feature by at least one screenshot pixel")


if __name__ == "__main__":
    main()
