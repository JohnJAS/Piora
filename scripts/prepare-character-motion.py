"""Bake the bundled wallpaper motion atlases (authoring only: numpy, opencv-python).

Run from any directory with the project's Node dependencies installed. The
original WebPs remain the sole source for all visible foreground artwork.
"""
import json
import subprocess
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public/themes/character-backgrounds"
EXPORT = """
const {createJiti} = require('jiti');
const jiti = createJiti(process.cwd()+'/package.json');
const {getCharacterPerformance,partBounds} = jiti('./lib/character-wallpaper-parts.ts');
const {presets} = require('./public/themes/character-backgrounds/manifest.json');
const result = presets.map(({id,asset}) => ({id,asset,parts:
  getCharacterPerformance(id).parts.map(p=>({...p,bounds:partBounds(p)}))}));
process.stdout.write(JSON.stringify(result));
"""


def bake(preset):
    src = cv2.imread(str(ROOT / "public" / preset["asset"].lstrip("/")))
    patches = []
    for i, part in enumerate(preset["parts"]):
        x, y, w, h = part["bounds"]
        path = np.asarray(part["outline"], dtype=np.float64) - [x, y]
        # Subpixel coverage in the alpha channel retains thin painted outlines.
        matte = np.zeros((h * 4, w * 4), np.uint8)
        cv2.fillPoly(matte, [np.rint(path * 4).astype(np.int32)], 255, cv2.LINE_AA)
        for hole in part.get("holes", []):
            inner = (np.asarray(hole, dtype=np.float64) - [x, y]) * 4
            cv2.fillPoly(matte, [np.rint(inner).astype(np.int32)], 0, cv2.LINE_AA)
        alpha = cv2.resize(matte, (w, h), interpolation=cv2.INTER_AREA)
        # Read past the frame by extending edge colors for cropped hair, etc.
        pad = 24
        yy = np.clip(np.arange(y - pad, y + h + pad), 0, src.shape[0] - 1)
        xx = np.clip(np.arange(x - pad, x + w + pad), 0, src.shape[1] - 1)
        crop = src[yy[:, None], xx]
        mask = np.pad((alpha > 0).astype(np.uint8), pad)
        mask = cv2.dilate(mask, np.ones((5, 5), np.uint8))
        repaired = cv2.inpaint(crop, mask, 4, cv2.INPAINT_TELEA)[pad:pad+h, pad:pad+w]
        # Some vacated regions reveal a cheek, patterned hair or wing ribs.
        # For those the art-directed clean plate supplies the hidden drawing.
        stem = Path(preset["asset"]).stem
        suffix = "" if i == 0 else f"-{i+1}"
        plate = ROOT / "scripts/character-motion-plates" / f"{stem}{suffix}.webp"
        if plate.is_file():
            repaired = cv2.imread(str(plate))
            if repaired.shape[:2] != (h, w):
                raise ValueError(f"Re-register the clean plate for {preset['id']}")
        # Store two coverages in one byte. The narrow outer band removes the
        # original antialiased outline without attaching a halo to the limb.
        erase = cv2.dilate(alpha, np.ones((5, 5), np.uint8))
        packed = np.uint8(np.rint(erase * (64 / 255) + alpha * (191 / 255)))
        patch = np.dstack((repaired, packed))
        patch[packed == 0] = 0
        patches.append(patch)
    atlas = np.zeros((max(p.shape[0] for p in patches), sum(p.shape[1] for p in patches), 4), np.uint8)
    offset = 0
    for patch in patches:
        h, w = patch.shape[:2]
        atlas[:h, offset:offset+w] = patch
        offset += w
    output = ASSETS / "motion" / (Path(preset["asset"]).stem + ".png")
    if not cv2.imwrite(str(output), atlas, [cv2.IMWRITE_PNG_COMPRESSION, 9]):
        raise OSError(output)


if __name__ == "__main__":
    (ASSETS / "motion").mkdir(exist_ok=True)
    for entry in json.loads(subprocess.check_output(["node", "-e", EXPORT], cwd=ROOT)):
        bake(entry)
