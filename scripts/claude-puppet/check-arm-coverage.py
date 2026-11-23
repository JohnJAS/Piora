"""Measure disconnected foreground area in the baked deforming arm at native stage scale."""

from argparse import ArgumentParser
from itertools import combinations
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from arm_mesh import triangles


POSES = ("idle", "page-turn", "chin-rest", "wave")
PAIRS = tuple(combinations(range(len(POSES)), 2))


def probe(skin, steps):
    rig = json.loads((skin / "rig.json").read_text(encoding="utf-8"))
    mesh = rig["armMesh"]
    with Image.open(skin / "parts-atlas.webp") as packed:
        atlas = np.array(packed.getchannel("A"))
    fields = [(atlas[y:y+h, x:x+w].astype(np.float32) / 255 * 2 - 1) * mesh["distanceRange"]
              for x, y, w, h in rig["hands"]["frames"]]
    source = np.array(mesh["source"], dtype=np.float32)
    stage = np.array(mesh["stage"], dtype=np.float32)
    origin = np.floor(stage.min(axis=(0, 1))).astype(int) - 2
    extent = np.ceil(stage.max(axis=(0, 1))).astype(int) - origin + 3
    stage -= origin
    source -= rig["hands"]["rect"][:2]
    index_groups = np.array(triangles(source.shape[1] // 2))
    section_coordinates = index_groups // 2
    report = []
    for pair, rounding in zip(PAIRS, mesh["fingerRoundingPx"]):
        first, second = pair
        worst = {"pixels": 0, "progress": 0.0}
        minimum_share = 1.0
        for step in range(steps + 1):
            t = step / steps
            placement = stage[first] * (1 - t) + stage[second] * t
            silhouette = np.zeros((extent[1], extent[0]), dtype=np.uint8)
            for triangle, sections in zip(index_groups, section_coordinates):
                p = placement[triangle]
                left, top = np.floor(p.min(axis=0)).astype(int)
                width, height = np.ceil(p.max(axis=0)).astype(int) - [left, top] + 1
                local = np.float32(p - [left, top])
                crop = (width, height)
                distance = [
                    cv2.warpAffine(fields[pose], cv2.getAffineTransform(source[pose][triangle], local),
                                   crop, flags=cv2.INTER_LINEAR, borderValue=-mesh["distanceRange"])
                    for pose in pair
                ]
                section_plane = np.linalg.solve(np.c_[local, np.ones(3)], sections)
                yy, xx = np.ogrid[:height, :width]
                section = xx * section_plane[0] + yy * section_plane[1] + section_plane[2]
                finger = np.clip((section - 6.4) / 1.6, 0, 1)
                finger = finger * finger * (3 - 2 * finger)
                combined = distance[0] * (1 - t) + distance[1] * t + rounding * 4 * t * (1 - t) * finger
                footprint = cv2.fillConvexPoly(np.zeros((height, width), dtype=np.uint8), np.round(local).astype(np.int32), 1)
                np.copyto(silhouette[top:top+height, left:left+width], np.uint8(combined > 0), where=footprint != 0)
            _, _, sizes, _ = cv2.connectedComponentsWithStats(silhouette, connectivity=8)
            sorted_sizes = np.sort(sizes[1:, cv2.CC_STAT_AREA])
            if not sorted_sizes.size:
                raise ValueError("Empty arm silhouette")
            minimum_share = min(minimum_share, float(sorted_sizes[-1] / sorted_sizes.sum()))
            second_size = int(sorted_sizes[-2]) if len(sorted_sizes) > 1 else 0
            if second_size > worst["pixels"]:
                worst = {"pixels": second_size, "progress": t}
        report.append({
            "poses": [POSES[first], POSES[second]],
            "samples": steps + 1,
            "minimumLargestComponentShare": minimum_share,
            "largestDetachedComponent": worst,
        })
    return report


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("skin", type=Path)
    parser.add_argument("--json", type=Path)
    args = parser.parse_args()
    rows = probe(args.skin, 200)
    result = json.dumps(rows, indent=2) + "\n"
    if args.json:
        args.json.write_text(result, encoding="utf-8")
    print(result, end="")
    # At native stage scale, the CPU raster can leave individual edge samples
    # at the antialias threshold. A larger island signals a detached detail.
    if any(row["largestDetachedComponent"]["pixels"] > 6 for row in rows):
        raise SystemExit("A blended gesture contains detached foreground")


if __name__ == "__main__":
    main()
