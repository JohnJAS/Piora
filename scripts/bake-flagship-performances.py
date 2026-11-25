"""Bake Tier 2 flagship VP9 performance clips locally from bundled paintings and motion atlases.

Run from the repository root:
    python scripts/bake-flagship-performances.py
"""
from __future__ import annotations

import json
import math
import subprocess
from pathlib import Path

import cv2 as cv
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CHAR_ASSETS = ROOT / "public" / "themes" / "character-backgrounds"
OUT_DIR = ROOT / "public" / "themes" / "piora-flagship" / "performances"
PREVIEW_DIR = ROOT / ".verification" / "flagship-tier2-preview"

SRC_W, SRC_H = 1672, 941
OUT_W, OUT_H = 1664, 936
RIGHT_X0 = int(SRC_W * 0.45)
FPS = 30.0
TAU = 2.0 * math.pi
GRID_Y, GRID_X = np.mgrid[:SRC_H, :SRC_W].astype(np.float32)

RIG_EXPORT_SCRIPT = """
const { createJiti } = require('jiti');
const jiti = createJiti(process.cwd() + '/package.json');
const { getCharacterWallpaperRig } = jiti('./lib/character-wallpaper-rigs.ts');
const { getCharacterPerformance, partBounds } = jiti('./lib/character-wallpaper-parts.ts');
const ids = ['character-whale-abyss', 'character-whale-tide'];
const out = Object.fromEntries(ids.map((id) => [id, {
  rig: getCharacterWallpaperRig(id),
  parts: getCharacterPerformance(id).parts.map((p) => ({ ...p, bounds: partBounds(p) })),
}]));
process.stdout.write(JSON.stringify(out));
"""


def smoothstep(edge0: np.ndarray | float, edge1: np.ndarray | float, x: np.ndarray | float) -> np.ndarray | float:
    denom = edge1 - edge0
    safe_denom = np.where(np.asarray(denom) != 0, denom, 1.0)
    t = np.clip((x - edge0) / safe_denom, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def quintic(t: float) -> float:
    x = max(0.0, min(1.0, t))
    return x * x * x * (x * (x * 6.0 - 15.0) + 10.0)


def ease_in_out(t: float) -> float:
    x = max(0.0, min(1.0, t))
    return x * x * (3.0 - 2.0 * x)


def load_rig_data() -> dict:
    raw = subprocess.check_output(["node", "-e", RIG_EXPORT_SCRIPT], cwd=ROOT)
    return json.loads(raw.decode("utf-8"))


def build_body_weights(rig: dict) -> dict:
    """Compute soft mesh weights restricted to the character ROI matching character-wallpaper-mesh.ts."""
    regions = [rig["head"], rig["chest"], *rig["sway"]]
    roi_x0 = max(0, int(min(cx - rx for cx, _, rx, _ in regions)) - 48)
    xx = GRID_X[:, roi_x0:]
    yy = GRID_Y[:, roi_x0:]

    def region_weight(region: list[float]) -> np.ndarray:
        cx, cy, rx, ry = region
        dist = np.hypot((xx - cx) / rx, (yy - cy) / ry)
        return smoothstep(1.0, 1.0 - 0.42, dist)

    edge_dist = np.minimum(np.minimum(xx, yy), np.minimum(SRC_W - xx, SRC_H - yy))
    pin_dist = np.full(xx.shape, np.inf, dtype=np.float32)
    if rig.get("headContact") is not None:
        hx_c, hy_c = rig["headContact"]
        pin_dist = np.minimum(pin_dist, np.hypot(xx - hx_c, yy - hy_c) - 20.0)
    for ax, ay, bx, by, radius in rig["pins"]:
        dx = bx - ax
        dy = by - ay
        denom = dx * dx + dy * dy or 1.0
        frac = np.clip(((xx - ax) * dx + (yy - ay) * dy) / denom, 0.0, 1.0)
        d = np.hypot(xx - ax - frac * dx, yy - ay - frac * dy)
        pin_dist = np.minimum(pin_dist, d - radius - 14.0)

    face_free = np.ones(xx.shape, dtype=np.float32)
    if rig.get("rigidFace"):
        fx, fy, frx, fry = rig["rigidFace"]
        fdist = np.hypot((xx - fx) / frx, (yy - fy) / fry)
        face_free = smoothstep(1.0, 1.42, fdist)

    head_free = face_free * smoothstep(0.0, 58.0, np.minimum(edge_dist, pin_dist))
    free = face_free * smoothstep(0.0, 28.0, np.minimum(edge_dist, pin_dist))

    head_raw = region_weight(rig["head"])
    chest_raw = (1.0 - head_raw) * region_weight(rig["chest"])
    sway0_raw = (1.0 - head_raw) * region_weight(rig["sway"][0])
    sway1_raw = (1.0 - head_raw) * region_weight(rig["sway"][1])

    hx, hy, _, hry = rig["head"]
    head_pivot = tuple(rig["headContact"]) if rig.get("headContact") else (hx, hy + hry * 0.72)

    def root_of(region: list[float]) -> tuple[float, float]:
        rx, ry, rrx, rry = region
        dx = hx - rx
        dy = hy - ry
        dist = math.hypot(dx / rrx, dy / rry) or 1.0
        return (rx + dx / dist, ry + dy / dist)

    return {
        "roi_x0": roi_x0,
        "xx": xx,
        "yy": yy,
        "head_w": head_free * head_raw,
        "chest_w": free * chest_raw + (1.0 - face_free) * 0.26,
        "sway0_w": free * sway0_raw,
        "sway1_w": free * sway1_raw,
        "head_pivot": head_pivot,
        "root0": root_of(rig["sway"][0]),
        "root1": root_of(rig["sway"][1]),
    }


def warp_body(
    img_bgr: np.ndarray,
    weights: dict,
    head_angle: float,
    lift_head: float,
    lift_chest: float,
    lean_head: float,
    lean_chest: float,
    sway0_angle: float,
    sway1_angle: float,
) -> np.ndarray:
    if (
        abs(head_angle) < 1e-5
        and abs(lift_head) < 1e-4
        and abs(lift_chest) < 1e-4
        and abs(lean_head) < 1e-4
        and abs(lean_chest) < 1e-4
        and abs(sway0_angle) < 1e-5
        and abs(sway1_angle) < 1e-5
    ):
        return img_bgr.copy()

    roi_x0 = weights["roi_x0"]
    xx = weights["xx"]
    yy = weights["yy"]
    head_w = weights["head_w"]
    chest_w = weights["chest_w"]
    sway0_w = weights["sway0_w"]
    sway1_w = weights["sway1_w"]
    px, py = weights["head_pivot"]
    r0x, r0y = weights["root0"]
    r1x, r1y = weights["root1"]

    c, s = math.cos(head_angle), math.sin(head_angle)
    ax, ay = xx - px, yy - py
    rot_dx = (c - 1.0) * ax - s * ay
    rot_dy = s * ax + (c - 1.0) * ay

    disp_x = head_w * (rot_dx + lean_head) + chest_w * lean_chest
    disp_y = head_w * (rot_dy - lift_head) - chest_w * lift_chest

    if abs(sway0_angle) > 1e-5:
        disp_x += sway0_w * (-(yy - r0y) * sway0_angle)
        disp_y += sway0_w * ((xx - r0x) * sway0_angle)
    if abs(sway1_angle) > 1e-5:
        disp_x += sway1_w * (-(yy - r1y) * sway1_angle)
        disp_y += sway1_w * ((xx - r1x) * sway1_angle)

    out = img_bgr.copy()
    map_x = (xx - disp_x).astype(np.float32)
    map_y = (yy - disp_y).astype(np.float32)
    out[:, roi_x0:] = cv.remap(img_bgr, map_x, map_y, cv.INTER_LINEAR, borderMode=cv.BORDER_REPLICATE)
    return out


def apply_atlas_parts(
    frame_bgr: np.ndarray,
    src_bgr: np.ndarray,
    atlas_bgra: np.ndarray,
    parts: list[dict],
    angles_deg: list[float],
) -> np.ndarray:
    """Apply hinged clean-plate cutouts matching layerAt() in character-wallpaper-renderer.ts."""
    out = frame_bgr.copy()
    split = 64.0 / 255.0

    atlas_x = 0
    for part, angle_deg in zip(parts, angles_deg):
        rx, ry, rw, rh = part["bounds"]
        patch = atlas_bgra[:rh, atlas_x : atlas_x + rw]
        atlas_x += rw
        if abs(angle_deg) < 1e-4:
            continue

        reach = max(math.hypot(px - part["pivot"][0], py - part["pivot"][1]) for px, py in part["outline"])
        rigid = bool(part.get("rigid", False))
        hinge_z = -max(8.0, reach * 0.14) if rigid else max(8.0, reach * 0.90)
        hinge_w = 3.0 + reach * abs(part["angle"]) * math.pi / 180.0 * 1.8
        pad = int(math.ceil(hinge_w + abs(angle_deg) * math.pi / 180.0 * reach + 12))

        x0 = max(0, rx - pad)
        y0 = max(0, ry - pad)
        x1 = min(SRC_W, rx + rw + pad)
        y1 = min(SRC_H, ry + rh + pad)
        roi_w, roi_h = x1 - x0, y1 - y0
        if roi_w <= 0 or roi_h <= 0:
            continue

        gx = GRID_X[y0:y1, x0:x1]
        gy = GRID_Y[y0:y1, x0:x1]
        pvx, pvy = part["pivot"]
        arm_x = gx - pvx
        arm_y = gy - pvy

        eff_angle = np.full((roi_h, roi_w), angle_deg * math.pi / 180.0, dtype=np.float32)
        if part.get("tether"):
            tx, ty, falloff_r = part["tether"]
            eff_angle *= smoothstep(0.0, falloff_r, np.hypot(gx - tx, gy - ty))
        if not rigid:
            edge = np.minimum(np.minimum(gx, gy), np.minimum(SRC_W - gx, SRC_H - gy))
            eff_angle *= smoothstep(0.0, 54.0, edge)
            arm_x = arm_x / (1.0 + 0.25 * np.sin(eff_angle))

        falloff = smoothstep(0.0, abs(hinge_z), np.hypot(arm_x, arm_y))
        a = -eff_angle * falloff
        ca, sa = np.cos(a), np.sin(a)
        rest_x = pvx + ca * arm_x - sa * arm_y
        rest_y = pvy + sa * arm_x + ca * arm_y

        patch_bgr = patch[:, :, :3]
        patch_a = patch[:, :, 3]

        back_lx = (gx - rx).astype(np.float32)
        back_ly = (gy - ry).astype(np.float32)
        back_bgr = cv.remap(patch_bgr, back_lx, back_ly, cv.INTER_LINEAR, borderMode=cv.BORDER_CONSTANT, borderValue=0)
        back_a = cv.remap(patch_a, back_lx, back_ly, cv.INTER_LINEAR, borderMode=cv.BORDER_CONSTANT, borderValue=0)

        rest_lx = (rest_x - rx).astype(np.float32)
        rest_ly = (rest_y - ry).astype(np.float32)
        rest_a = cv.remap(patch_a, rest_lx, rest_ly, cv.INTER_LINEAR, borderMode=cv.BORDER_CONSTANT, borderValue=0)
        rest_fg_bgr = cv.remap(src_bgr, rest_x.astype(np.float32), rest_y.astype(np.float32), cv.INTER_LINEAR, borderMode=cv.BORDER_REPLICATE)

        front = np.clip((rest_a - split) / (1.0 - split), 0.0, 1.0)[..., None]
        old_front = np.clip((back_a - split) / (1.0 - split), 0.0, 1.0)
        move_dist = np.hypot(gx - rest_x, gy - rest_y)
        erase = old_front + (np.clip(back_a / split, 0.0, 1.0) - old_front) * smoothstep(0.25, 2.5, move_dist)
        reveal = np.clip((erase[..., None] - front) / np.maximum(0.001, 1.0 - front), 0.0, 1.0)

        under = out[y0:y1, x0:x1]
        revealed = under * (1.0 - reveal) + back_bgr * reveal
        out[y0:y1, x0:x1] = revealed * (1.0 - front) + rest_fg_bgr * front

    return out


def apply_eye_expression(
    frame_bgr: np.ndarray,
    src_bgr: np.ndarray,
    rig: dict,
    blink_amount: float,
    gaze_x: float,
    gaze_y: float,
    sparkle: float,
    blush: float,
) -> np.ndarray:
    """Apply natural eye gaze, joyful blink, subtle blush, and iris catchlight sparkle."""
    if blink_amount <= 1e-4 and abs(gaze_x) <= 1e-4 and abs(gaze_y) <= 1e-4 and sparkle <= 1e-4 and blush <= 1e-4:
        return frame_bgr

    out = frame_bgr.copy()
    for eye in rig["eyes"]:
        lx, ly, rx, ry, h_up, h_lo = eye
        pad = 24
        x0 = max(0, int(min(lx, rx) - pad))
        y0 = max(0, int(min(ly, ry) - h_up - pad))
        x1 = min(SRC_W, int(max(lx, rx) + pad))
        y1 = min(SRC_H, int(max(ly, ry) + h_lo + pad))
        if x1 <= x0 or y1 <= y0:
            continue

        gx = GRID_X[y0:y1, x0:x1]
        gy = GRID_Y[y0:y1, x0:x1]
        chord_x, chord_y = rx - lx, ry - ly
        width = math.hypot(chord_x, chord_y)
        along_x, along_y = chord_x / width, chord_y / width
        down_x, down_y = -along_y, along_x

        off_x, off_y = gx - lx, gy - ly
        horiz = (off_x * along_x + off_y * along_y) / width
        vert = off_x * down_x + off_y * down_y

        safe_h = np.clip(horiz, 0.0, 1.0)
        arc = np.sqrt(4.0 * safe_h * (1.0 - safe_h))
        upper = -h_up * arc
        lower = h_lo * arc

        roi = out[y0:y1, x0:x1]
        in_eye = (horiz > 0.0) & (horiz < 1.0) & (vert > upper - 4.5) & (vert < lower + 5.0)
        if np.any(in_eye) and (abs(gaze_x) > 1e-4 or abs(gaze_y) > 1e-4):
            sclera = (
                smoothstep(upper + 0.6, upper + 3.0, vert)
                * (1.0 - smoothstep(lower - 3.0, lower - 0.6, vert))
                * smoothstep(0.03, 0.18, safe_h)
                * (1.0 - smoothstep(0.82, 0.97, safe_h))
            )[..., None]
            sx = along_x * (width * 0.085 * gaze_x) + down_x * (h_lo * 0.22 * gaze_y)
            sy = along_y * (width * 0.085 * gaze_x) + down_y * (h_lo * 0.22 * gaze_y)
            shifted = cv.remap(src_bgr, (gx - sx).astype(np.float32), (gy - sy).astype(np.float32), cv.INTER_LINEAR, borderMode=cv.BORDER_REPLICATE)
            roi = roi * (1.0 - sclera) + shifted * sclera

        if blink_amount > 1e-4:
            cx, cy = (lx + rx) * 0.5, (ly + ry) * 0.5

            def sample_pt(px: float, py: float) -> np.ndarray:
                ix = max(0, min(SRC_W - 1, int(round(px))))
                iy = max(0, min(SRC_H - 1, int(round(py))))
                return src_bgr[iy, ix]

            cheek = sample_pt(cx + down_x * (h_lo + 8.0), cy + down_y * (h_lo + 8.0))
            skin_above = sample_pt(cx - down_x * (h_up + 6.5), cy - down_y * (h_up + 6.5))
            bx, by = cx + down_x * (h_lo + 5.0), cy + down_y * (h_lo + 5.0)
            skin_left = sample_pt(bx - chord_x * 0.22, by - chord_y * 0.22)
            skin_right = sample_pt(bx + chord_x * 0.22, by + chord_y * 0.22)

            skin_above = cheek + (skin_above - cheek) * (1.0 - smoothstep(0.07, 0.19, float(np.linalg.norm(cheek - skin_above))))
            skin_left = cheek + (skin_left - cheek) * (1.0 - smoothstep(0.09, 0.24, float(np.linalg.norm(cheek - skin_left))))
            skin_right = cheek + (skin_right - cheek) * (1.0 - smoothstep(0.09, 0.24, float(np.linalg.norm(cheek - skin_right))))

            horiz_blend = smoothstep(0.0, 1.0, safe_h)[..., None]
            skin_below = skin_left * (1.0 - horiz_blend) + skin_right * horiz_blend
            vert_blend = np.clip((vert - upper) / np.maximum(0.5, lower - upper), 0.0, 1.0)
            vert_blend = (vert_blend * vert_blend * (3.0 - 2.0 * vert_blend))[..., None]
            skin = skin_above * (1.0 - vert_blend) + skin_below * vert_blend
            dist_skin = np.linalg.norm(skin - roi, axis=2, keepdims=True)
            skin = skin + (roi - skin) * ((1.0 - smoothstep(0.045, 0.16, dist_skin)) * 0.8)

            closed = upper + (lower - upper) * 0.62
            lid_top = upper + (closed - 0.4 * arc - upper) * blink_amount
            lid_bot = lower + (closed + 0.4 * arc - lower) * blink_amount
            aperture = (
                smoothstep(lid_top - 0.7, lid_top + 0.5, vert)
                * (1.0 - smoothstep(lid_bot - 0.5, lid_bot + 0.7, vert))
                * (1.0 - smoothstep(0.83, 1.0, blink_amount))
            )[..., None]
            crease = (1.0 - smoothstep(0.0, 4.0 + 0.05 * width, np.abs(vert - lid_top + 3.2 * arc)))[..., None]
            lid = skin * (1.0 - 0.075 * arc[..., None] * crease * blink_amount)
            lid = lid * (1.0 - aperture) + roi * aperture

            lash = sample_pt(cx - down_x * (h_up - 3.0), cy - down_y * (h_up - 3.0))
            ink = skin * 0.38 * 0.68 + lash * 0.32
            stroke = arc * max(1.15, min(2.25, width * 0.028))
            line = (1.0 - smoothstep(stroke * 0.45, stroke + 0.8, np.abs(vert - lid_top)))[..., None]
            lid = lid * (1.0 - line * smoothstep(0.08, 0.8, blink_amount)) + ink * (line * smoothstep(0.08, 0.8, blink_amount))

            feather = (
                smoothstep(0.0, 0.075, horiz)
                * (1.0 - smoothstep(0.925, 1.0, horiz))
                * smoothstep(upper - 4.5, upper + 0.5, vert)
                * (1.0 - smoothstep(lower - 0.5, lower + 5.0, vert))
            )[..., None] * smoothstep(0.0, 0.28, blink_amount)
            roi = roi * (1.0 - feather) + lid * feather

        if sparkle > 1e-4 and blink_amount < 0.55:
            cx, cy = (lx + rx) * 0.5, (ly + ry) * 0.5
            sx_pos = cx - along_x * (width * 0.14) - down_x * (h_up * 0.26)
            sy_pos = cy - along_y * (width * 0.14) - down_y * (h_up * 0.26)
            sd = np.hypot(gx - sx_pos, gy - sy_pos)
            glow = np.exp(-(sd / max(2.2, width * 0.085)) ** 2)[..., None] * sparkle * (1.0 - blink_amount) * 0.55
            roi = np.clip(roi + glow * np.float32([1.0, 0.96, 0.88]), 0.0, 1.0)

        out[y0:y1, x0:x1] = roi

        if blush > 1e-4:
            cx, cy = (lx + rx) * 0.5, (ly + ry) * 0.5
            bx_c = cx + down_x * (h_lo * 2.1)
            by_c = cy + down_y * (h_lo * 2.1)
            rx_b = max(14, int(width * 0.48))
            ry_b = max(10, int(h_lo * 0.95))
            bx0, by0 = max(0, int(bx_c - rx_b * 2)), max(0, int(by_c - ry_b * 2))
            bx1, by1 = min(SRC_W, int(bx_c + rx_b * 2)), min(SRC_H, int(by_c + ry_b * 2))
            if bx1 > bx0 and by1 > by0:
                bgx = GRID_X[by0:by1, bx0:bx1]
                bgy = GRID_Y[by0:by1, bx0:bx1]
                bd = ((bgx - bx_c) / rx_b) ** 2 + ((bgy - by_c) / ry_b) ** 2
                mask = np.exp(-bd * 1.4)[..., None] * blush * 0.13
                rose = np.float32([0.62, 0.58, 0.98])
                out[by0:by1, bx0:bx1] = out[by0:by1, bx0:bx1] * (1.0 - mask) + rose * mask

    return out


def render_spirit_whale(
    frame_bgr: np.ndarray,
    right_mask: np.ndarray,
    head_region: list[float],
    progress: float,
    visibility: float,
) -> np.ndarray:
    """Draw a graceful translucent bioluminescent Spirit Whale arcing around the portrait into the upper-right glass."""
    if visibility <= 1e-4:
        return frame_bgr

    # Arc left-and-up out of the orb [1168, 378] cleanly around/above her head [1236, 251] toward [1510, 95]
    p = ease_in_out(progress)
    cx = 1155.0 - 210.0 * math.sin(p * math.pi * 0.85) + 365.0 * (p ** 1.45)
    cy = 372.0 - 285.0 * (p ** 0.88) - 24.0 * math.sin(p * math.pi)
    # Tangent heading along the arc
    dp = 0.01
    p2 = ease_in_out(min(1.0, progress + dp))
    cx2 = 1155.0 - 210.0 * math.sin(p2 * math.pi * 0.85) + 365.0 * (p2 ** 1.45)
    cy2 = 372.0 - 285.0 * (p2 ** 0.88) - 24.0 * math.sin(p2 * math.pi)
    heading = math.atan2(cy2 - cy, cx2 - cx) if (abs(cx2 - cx) + abs(cy2 - cy) > 1e-4) else -0.65

    scale = 0.62 + 0.34 * math.sin(progress * math.pi)
    length = 178.0 * scale
    swim_phase = progress * 5.2 * math.pi

    s_vals = np.linspace(0.0, 1.0, 64)
    spine_pts = []
    half_w = []
    ux, uy = math.cos(heading), math.sin(heading)
    nx, ny = -uy, ux

    for s in s_vals:
        axial = (0.35 - s) * length
        undul = math.sin(swim_phase - s * 4.4) * (8.5 * scale) * (s ** 1.65)
        px = cx + axial * ux + undul * nx
        py = cy + axial * uy + undul * ny
        spine_pts.append((px, py))

        if s < 0.22:
            w = 18.5 * scale * math.sin((s / 0.22) * math.pi * 0.5) ** 0.78
        elif s < 0.83:
            t = (s - 0.22) / 0.61
            w = 18.5 * scale * (1.0 - 0.84 * (t ** 1.25))
            # Subtle graceful dorsal fin silhouette around s=0.62
            if 0.54 < s < 0.68:
                w += 6.0 * scale * math.sin(((s - 0.54) / 0.14) * math.pi)
        else:
            t = (s - 0.83) / 0.17
            w = 3.2 * scale + 31.0 * scale * math.sin(t * math.pi * 0.65)
        half_w.append(w)

    upper_pts = []
    lower_pts = []
    for i, (px, py) in enumerate(spine_pts):
        p_prev = spine_pts[max(0, i - 1)]
        p_next = spine_pts[min(len(spine_pts) - 1, i + 1)]
        tx, ty = p_next[0] - p_prev[0], p_next[1] - p_prev[1]
        tl = math.hypot(tx, ty) or 1.0
        lnx, lny = -ty / tl, tx / tl
        w = half_w[i]
        upper_pts.append((px - lnx * w * 0.82, py - lny * w * 0.82))
        lower_pts.append((px + lnx * w * 1.14, py + lny * w * 1.14))

    tx_end, ty_end = spine_pts[-1]
    upper_pts.append((tx_end + ux * (-11.0 * scale), ty_end + uy * (-11.0 * scale)))
    poly = np.array(upper_pts + list(reversed(lower_pts)), dtype=np.float32)

    fin_root = spine_pts[20]
    fin_poly = np.array(
        [
            fin_root,
            (fin_root[0] - ux * 16 * scale + nx * 12 * scale, fin_root[1] - uy * 16 * scale + ny * 12 * scale),
            (fin_root[0] - ux * 58 * scale + nx * 42 * scale, fin_root[1] - uy * 58 * scale + ny * 42 * scale),
            (fin_root[0] - ux * 38 * scale + nx * 18 * scale, fin_root[1] - uy * 38 * scale + ny * 18 * scale),
            (fin_root[0] - ux * 26 * scale + nx * 7 * scale, fin_root[1] - uy * 26 * scale + ny * 7 * scale),
        ],
        dtype=np.float32,
    )

    all_pts = np.vstack([poly, fin_poly])
    pad = 48
    x0 = max(RIGHT_X0, int(np.floor(all_pts[:, 0].min())) - pad)
    y0 = max(0, int(np.floor(all_pts[:, 1].min())) - pad)
    x1 = min(SRC_W, int(np.ceil(all_pts[:, 0].max())) + pad)
    y1 = min(SRC_H, int(np.ceil(all_pts[:, 1].max())) + pad)
    rw, rh = x1 - x0, y1 - y0
    if rw <= 0 or rh <= 0:
        return frame_bgr

    ss = 2
    mask_hi = np.zeros((rh * ss, rw * ss), dtype=np.float32)
    cv.fillPoly(mask_hi, [np.rint((poly - [x0, y0]) * ss * 16).astype(np.int32)], 1.0, cv.LINE_AA, shift=4)
    cv.fillPoly(mask_hi, [np.rint((fin_poly - [x0, y0]) * ss * 16).astype(np.int32)], 0.85, cv.LINE_AA, shift=4)
    silhouette = cv.resize(mask_hi, (rw, rh), interpolation=cv.INTER_AREA)

    core_halo = cv.GaussianBlur(silhouette, (0, 0), 11.0)
    inner_edge = np.clip(silhouette - cv.erode(silhouette, np.ones((5, 5), np.uint8)), 0.0, 1.0)
    rim = cv.GaussianBlur(inner_edge, (0, 0), 1.8)

    gx = GRID_X[y0:y1, x0:x1]
    gy = GRID_Y[y0:y1, x0:x1]
    hx, hy, hrx, hry = head_region
    head_guard = smoothstep(0.65, 1.15, np.hypot((gx - hx) / hrx, (gy - hy) / hry))[..., None]
    dist_center = np.hypot(gx - cx, gy - cy) / max(36.0, length * 0.45)
    body_glow = np.clip(0.55 - dist_center * 0.22, 0.20, 0.65) * silhouette

    aqua = np.float32([1.0, 0.88, 0.34])
    pearl = np.float32([1.0, 0.98, 0.90])
    rm_roi = right_mask[:, x0 - RIGHT_X0 : x1 - RIGHT_X0][y0:y1]

    light = (
        aqua * (core_halo[..., None] * 0.36 + body_glow[..., None] * 0.46)
        + pearl * (rim[..., None] * 0.72 + body_glow[..., None] * 0.22)
    ) * visibility * rm_roi * (0.25 + 0.75 * head_guard)

    out = frame_bgr.copy()
    roi = out[y0:y1, x0:x1]
    out[y0:y1, x0:x1] = np.clip(roi + light * (1.0 - roi * 0.52), 0.0, 1.0)
    return out


class AuraCache:
    """Precomputed right-ROI beacon distance & sunbeam masks for fast per-frame compositing."""

    def __init__(
        self,
        beacon_xy: tuple[float, float],
        beacon_r: float,
        halo_r: float,
        with_sunbeam: bool = False,
        face_guard: list[float] | None = None,
    ):
        xx = GRID_X[:, RIGHT_X0:]
        yy = GRID_Y[:, RIGHT_X0:]
        bx, by = beacon_xy
        d = np.hypot(xx - bx, yy - by)
        self.d = d
        self.beacon_r = max(1.0, beacon_r)
        self.halo_r = max(1.0, halo_r)
        guard = 1.0
        if face_guard is not None:
            fx, fy, frx, fry = face_guard
            guard = smoothstep(0.65, 1.20, np.hypot((xx - fx) / frx, (yy - fy) / fry))
        self.face_guard = guard
        self.base_aura = (
            (
                np.exp(-((d / self.beacon_r) ** 2) * 1.45)
                + np.exp(-((d / self.halo_r) ** 2) * 1.35) * 0.32
            )
            * guard
        ).astype(np.float32)

        if with_sunbeam:
            diag = (xx - SRC_W * 0.68) * 0.58 + (yy - SRC_H * 0.05) * 0.81
            ray1 = np.exp(-(((diag - 180.0) / 170.0) ** 2))
            ray2 = np.exp(-(((diag - 410.0) / 130.0) ** 2)) * 0.65
            sun_fade = smoothstep(SRC_H * 0.85, SRC_H * 0.08, yy)
            self.sun_mask = ((ray1 + ray2) * sun_fade).astype(np.float32)
        else:
            self.sun_mask = None


def render_aura_and_particles(
    frame_bgr: np.ndarray,
    right_mask: np.ndarray,
    aura_cache: AuraCache,
    color_bgr: tuple[float, float, float],
    strength: float,
    rings: list[float],
    particles: list[tuple[float, float, float, float, tuple[float, float, float]]],
    sunbeam_strength: float = 0.0,
) -> np.ndarray:
    """Apply smooth right-masked beacon glow, concentric rings, sunbeam, and bokeh motes."""
    if strength <= 1e-4 and not rings and not particles and sunbeam_strength <= 1e-4:
        return frame_bgr

    aura = aura_cache.base_aura * strength
    for r_phase in rings:
        if 0.001 < r_phase < 0.999:
            rad = aura_cache.beacon_r * 0.6 + (aura_cache.halo_r * 1.15 - aura_cache.beacon_r * 0.6) * r_phase
            band = (aura_cache.d - rad) / max(5.0, aura_cache.beacon_r * 0.20)
            aura += np.exp(-(band * band)) * aura_cache.face_guard * (math.sin(r_phase * math.pi) * max(0.35, strength) * 0.48)

    aura_rgb = np.float32(color_bgr) * (aura * right_mask[..., 0])[..., None]

    if sunbeam_strength > 1e-4 and aura_cache.sun_mask is not None:
        aura_rgb += np.float32([0.92, 0.97, 1.0]) * (aura_cache.sun_mask * right_mask[..., 0] * aura_cache.face_guard)[..., None] * (0.20 * sunbeam_strength)

    out = frame_bgr.copy()
    roi = out[:, RIGHT_X0:]
    luma = roi[:, :, 2] * 0.299 + roi[:, :, 1] * 0.587 + roi[:, :, 0] * 0.114
    luma_blend = smoothstep(0.72, 0.97, luma)[..., None]

    luminous = np.clip(roi + aura_rgb * (1.0 - roi * 0.58), 0.0, 1.0)
    amount = np.clip(np.max(aura_rgb, axis=2, keepdims=True) * 0.35, 0.0, 0.24)
    glazed = roi * (1.0 - amount) + np.float32(color_bgr) * amount
    out[:, RIGHT_X0:] = luminous * (1.0 - luma_blend) + glazed * luma_blend

    for px, py, pr, p_alpha, p_bgr in particles:
        if p_alpha <= 1e-4:
            continue
        pad = int(math.ceil(pr * 2.8))
        x0, y0 = max(RIGHT_X0, int(px - pad)), max(0, int(py - pad))
        x1, y1 = min(SRC_W, int(px + pad)), min(SRC_H, int(py + pad))
        if x1 <= x0 or y1 <= y0:
            continue
        pgx = GRID_X[y0:y1, x0:x1]
        pgy = GRID_Y[y0:y1, x0:x1]
        pd = np.hypot(pgx - px, pgy - py) / max(1.0, pr)
        mote = (np.exp(-(pd * pd) * 1.8) * p_alpha)[..., None] * right_mask[y0:y1, x0 - RIGHT_X0 : x1 - RIGHT_X0]
        p_roi = out[y0:y1, x0:x1]
        out[y0:y1, x0:x1] = np.clip(p_roi + np.float32(p_bgr) * mote * (1.0 - p_roi * 0.48), 0.0, 1.0)

    return out


def make_contact_sheet(frames: list[np.ndarray], out_path: Path, title: str) -> None:
    indices = [0, len(frames) // 7, (len(frames) * 2) // 7, (len(frames) * 3) // 7,
               (len(frames) * 4) // 7, (len(frames) * 5) // 7, (len(frames) * 6) // 7, len(frames) - 1]
    tw, th = 416, 234
    sheet = np.zeros((th * 2, tw * 4, 3), dtype=np.uint8)
    for slot, idx in enumerate(indices):
        tile = cv.resize(frames[idx], (tw, th), interpolation=cv.INTER_AREA)
        cv.putText(tile, f"{title} #{idx}", (10, 22), cv.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2, cv.LINE_AA)
        cv.putText(tile, f"{title} #{idx}", (10, 22), cv.FONT_HERSHEY_SIMPLEX, 0.55, (20, 40, 70), 1, cv.LINE_AA)
        r, c = divmod(slot, 4)
        sheet[r * th : (r + 1) * th, c * tw : (c + 1) * tw] = tile
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cv.imwrite(str(out_path), sheet)


def write_vp9_clip(frames_src: list[np.ndarray], output_path: Path) -> int:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = output_path.with_suffix(".tmp.webm")
    writer = cv.VideoWriter(str(tmp_path), cv.VideoWriter_fourcc(*"VP90"), FPS, (OUT_W, OUT_H))
    if not writer.isOpened():
        raise RuntimeError(f"Could not open VP9 VideoWriter for {output_path}")
    try:
        for frame in frames_src:
            scaled = cv.resize(frame, (OUT_W, OUT_H), interpolation=cv.INTER_AREA)
            writer.write(scaled)
    finally:
        writer.release()

    cap = cv.VideoCapture(str(tmp_path))
    if not cap.isOpened() or int(cap.get(cv.CAP_PROP_FRAME_COUNT)) != len(frames_src):
        cap.release()
        raise RuntimeError(f"Encoded clip verification failed for {output_path}")
    cap.release()
    tmp_path.replace(output_path)
    return output_path.stat().st_size


def make_right_mask() -> np.ndarray:
    xx = GRID_X[:, RIGHT_X0:]
    mask = smoothstep(SRC_W * 0.46, SRC_W * 0.56, xx)
    return mask[..., None].astype(np.float32)


def bake_night_celebrate(src_bgr: np.ndarray, atlas: np.ndarray, meta: dict, weights: dict, right_mask: np.ndarray) -> list[np.ndarray]:
    rig, parts = meta["rig"], meta["parts"]
    aura_cache = AuraCache((1168.0, 378.0), 56.0, 225.0, face_guard=[rig["head"][0], rig["head"][1], rig["head"][2] * 0.65, rig["head"][3] * 0.65])
    base_u8 = np.uint8(np.rint(np.clip(src_bgr, 0.0, 1.0) * 255.0))
    total = 126
    bookend = 6
    frames = []

    for i in range(total):
        if i < bookend or i >= total - bookend:
            frames.append(base_u8)
            continue

        u = (i - bookend) / (total - 2 * bookend - 1)
        env = math.sin(u * math.pi) ** 1.15
        act1 = ease_in_out(min(1.0, u / 0.34))
        act_down = ease_in_out(max(0.0, (u - 0.68) / 0.32))
        pose = act1 * (1.0 - act_down)

        head_angle = -0.055 * pose + 0.022 * math.sin(u * TAU * 1.5) * env
        lift_head = 10.5 * pose
        lift_chest = 6.5 * pose
        lean_head = -5.0 * pose
        lean_chest = -2.0 * pose
        sway0 = 0.045 * math.sin(u * TAU * 2.0) * env
        sway1 = 0.052 * math.sin(u * TAU * 2.0 - 0.4) * env

        blink_a = math.exp(-(((u - 0.14) / 0.032) ** 2))
        blink_b = math.exp(-(((u - 0.84) / 0.032) ** 2))
        blink = max(blink_a, blink_b) * 0.92
        gaze_x = 0.35 * math.sin(u * math.pi)
        gaze_y = -0.45 * pose

        body = warp_body(src_bgr, weights, head_angle, lift_head, lift_chest, lean_head, lean_chest, sway0, sway1)
        tail_deg = 12.0 * pose + 4.5 * math.sin(u * TAU * 2.0) * env
        fin_deg = 18.0 * pose + 5.5 * math.sin(u * TAU * 2.5 - 0.3) * env
        body = apply_atlas_parts(body, src_bgr, atlas, parts, [tail_deg, fin_deg])
        body = apply_eye_expression(body, src_bgr, rig, blink, gaze_x, gaze_y, sparkle=0.85 * pose, blush=pose)

        if 0.22 <= u <= 0.80:
            wp = (u - 0.22) / 0.58
            w_vis = math.sin(wp * math.pi) ** 0.72 * 0.78
            body = render_spirit_whale(body, right_mask, rig["head"], wp, w_vis)

        rings = [((u * 2.4) % 1.0) if 0.12 < u < 0.85 else 0.0, (((u * 2.4) + 0.5) % 1.0) if 0.18 < u < 0.82 else 0.0]
        particles = []
        for k in range(16):
            seed_a = math.sin(k * 19.37 + 0.7) * 0.5 + 0.5
            seed_b = math.cos(k * 43.11 + 1.9) * 0.5 + 0.5
            px = SRC_W * (0.58 + 0.38 * seed_a) + math.sin(u * TAU * 2.0 + k) * 24.0
            py = SRC_H * (0.94 - ((u * (0.75 + 0.45 * seed_b) + seed_b) % 0.95))
            pr = 3.8 + 6.5 * seed_a
            p_alpha = env * 0.58 * math.sin(((u + seed_b) % 1.0) * math.pi)
            p_bgr = (1.0, 0.92, 0.45) if k % 3 else (0.98, 0.96, 0.85)
            particles.append((px, py, pr, p_alpha, p_bgr))

        particles.append((978.0, 128.0, 44.0, 0.36 * pose, (1.0, 0.84, 0.35)))
        particles.append((1064.0, 200.0, 36.0, 0.34 * pose, (1.0, 0.84, 0.35)))

        lit = render_aura_and_particles(
            body,
            right_mask,
            aura_cache,
            color_bgr=(0.98, 0.88, 0.36),
            strength=0.78 * env,
            rings=rings,
            particles=particles,
        )
        frames.append(np.uint8(np.rint(np.clip(lit, 0.0, 1.0) * 255.0)))

    return frames


def bake_night_salute(src_bgr: np.ndarray, atlas: np.ndarray, meta: dict, weights: dict, right_mask: np.ndarray) -> list[np.ndarray]:
    rig, parts = meta["rig"], meta["parts"]
    aura_cache = AuraCache((1168.0, 378.0), 54.0, 215.0, face_guard=[rig["head"][0], rig["head"][1], rig["head"][2] * 0.65, rig["head"][3] * 0.65])
    base_u8 = np.uint8(np.rint(np.clip(src_bgr, 0.0, 1.0) * 255.0))
    total = 96
    bookend = 6
    frames = []

    for i in range(total):
        if i < bookend or i >= total - bookend:
            frames.append(base_u8)
            continue

        u = (i - bookend) / (total - 2 * bookend - 1)
        env = math.sin(u * math.pi)
        hold = quintic(min(1.0, u / 0.32)) * (1.0 - quintic(max(0.0, (u - 0.68) / 0.32)))

        head_angle = 0.042 * hold - 0.015 * math.sin(u * TAU) * env
        lift_head = 6.5 * hold
        lift_chest = 4.5 * hold
        lean_head = -4.2 * hold
        lean_chest = -1.5 * hold
        sway0 = 0.032 * math.sin(u * TAU * 1.5) * env
        sway1 = 0.038 * math.sin(u * TAU * 1.5 - 0.3) * env

        blink = math.exp(-(((u - 0.22) / 0.045) ** 2)) * 0.90
        body = warp_body(src_bgr, weights, head_angle, lift_head, lift_chest, lean_head, lean_chest, sway0, sway1)
        tail_deg = 9.5 * hold + 3.0 * math.sin(u * TAU * 1.5) * env
        fin_deg = 16.0 * hold + 4.0 * math.sin(u * TAU * 2.0) * env
        body = apply_atlas_parts(body, src_bgr, atlas, parts, [tail_deg, fin_deg])
        body = apply_eye_expression(body, src_bgr, rig, blink, gaze_x=-0.12 * hold, gaze_y=-0.18 * hold, sparkle=0.75 * hold, blush=hold * 0.9)

        rings = [((u * 1.8) % 1.0) if 0.12 < u < 0.88 else 0.0, (((u * 1.8) + 0.5) % 1.0) if 0.16 < u < 0.84 else 0.0]
        particles = []
        for k in range(12):
            seed_a = math.sin(k * 27.1 + 1.1) * 0.5 + 0.5
            seed_b = math.cos(k * 51.7 + 0.4) * 0.5 + 0.5
            px = 1168.0 + math.cos(u * TAU + k * 0.65) * (65.0 + 130.0 * seed_a)
            py = 378.0 + math.sin(u * TAU + k * 0.65) * (45.0 + 95.0 * seed_b) - 35.0 * u
            pr = 4.5 + 6.5 * seed_a
            particles.append((px, py, pr, 0.58 * env, (0.36, 0.78, 1.0) if k % 2 == 0 else (0.98, 0.90, 0.45)))

        lit = render_aura_and_particles(
            body,
            right_mask,
            aura_cache,
            color_bgr=(0.30, 0.76, 1.00),
            strength=0.72 * env,
            rings=rings,
            particles=particles,
        )
        frames.append(np.uint8(np.rint(np.clip(lit, 0.0, 1.0) * 255.0)))

    return frames


def bake_day_salute(src_bgr: np.ndarray, atlas: np.ndarray, meta: dict, weights: dict, right_mask: np.ndarray) -> list[np.ndarray]:
    rig, parts = meta["rig"], meta["parts"]
    aura_cache = AuraCache(
        (1218.0, 322.0),
        38.0,
        142.0,
        with_sunbeam=True,
        face_guard=[rig["head"][0], rig["head"][1], rig["head"][2] * 0.72, rig["head"][3] * 0.72],
    )
    base_u8 = np.uint8(np.rint(np.clip(src_bgr, 0.0, 1.0) * 255.0))
    total = 96
    bookend = 6
    frames = []

    for i in range(total):
        if i < bookend or i >= total - bookend:
            frames.append(base_u8)
            continue

        u = (i - bookend) / (total - 2 * bookend - 1)
        env = math.sin(u * math.pi)
        hold = quintic(min(1.0, u / 0.34)) * (1.0 - quintic(max(0.0, (u - 0.66) / 0.34)))

        antic = -0.14 * math.exp(-(((u - 0.12) / 0.07) ** 2))
        cup_curve = hold + antic
        head_angle = 0.036 * hold
        lift_chest = 5.2 * hold
        lean_chest = 2.0 * hold
        sway0 = 0.034 * math.sin(u * TAU * 1.5) * env
        sway1 = 0.038 * math.sin(u * TAU * 1.5 - 0.35) * env

        blink = math.exp(-(((u - 0.24) / 0.045) ** 2)) * 0.90
        body = warp_body(src_bgr, weights, head_angle, 0.0, lift_chest, 0.0, lean_chest, sway0, sway1)
        cup_deg = -13.0 * cup_curve
        tail_deg = 12.5 * hold + 3.5 * math.sin(u * TAU * 1.5) * env
        body = apply_atlas_parts(body, src_bgr, atlas, parts, [cup_deg, tail_deg])
        body = apply_eye_expression(body, src_bgr, rig, blink, gaze_x=-0.10 * hold, gaze_y=-0.15 * hold, sparkle=0.80 * hold, blush=hold)

        rings = [((u * 1.75) % 1.0) if 0.14 < u < 0.86 else 0.0, (((u * 1.75) + 0.5) % 1.0) if 0.18 < u < 0.82 else 0.0]
        particles = []
        for k in range(14):
            seed_a = math.sin(k * 31.3 + 2.1) * 0.5 + 0.5
            seed_b = math.cos(k * 17.9 + 0.8) * 0.5 + 0.5
            px = SRC_W * (0.56 + 0.40 * seed_a) - 70.0 * u * (0.4 + seed_b)
            py = SRC_H * (0.08 + 0.82 * ((seed_b + u * 0.65) % 1.0)) + math.sin(u * TAU * 2.0 + k) * 18.0
            pr = 5.0 + 7.5 * seed_a
            particles.append((px, py, pr, 0.55 * env, (0.98, 0.95, 0.82) if k % 2 == 0 else (0.62, 0.88, 1.0)))

        lit = render_aura_and_particles(
            body,
            right_mask,
            aura_cache,
            color_bgr=(0.95, 0.88, 0.62),
            strength=0.45 * env,
            rings=rings,
            particles=particles,
            sunbeam_strength=0.65 * env,
        )
        frames.append(np.uint8(np.rint(np.clip(lit, 0.0, 1.0) * 255.0)))

    return frames


def main() -> None:
    rigs_and_parts = load_rig_data()
    right_mask = make_right_mask()

    abyss_meta = rigs_and_parts["character-whale-abyss"]
    abyss_weights = build_body_weights(abyss_meta["rig"])
    abyss_bgr = cv.imread(str(CHAR_ASSETS / "whale-abyss.webp"), cv.IMREAD_COLOR).astype(np.float32) / 255.0
    abyss_atlas = cv.imread(str(CHAR_ASSETS / "motion" / "whale-abyss.png"), cv.IMREAD_UNCHANGED).astype(np.float32) / 255.0

    jobs = [
        (
            "whale-night-celebrate",
            lambda: bake_night_celebrate(abyss_bgr, abyss_atlas, abyss_meta, abyss_weights, right_mask),
            OUT_DIR / "whale-night-celebrate.webm",
            PREVIEW_DIR / "whale-night-celebrate-strip.png",
        ),
        (
            "whale-night-salute",
            lambda: bake_night_salute(abyss_bgr, abyss_atlas, abyss_meta, abyss_weights, right_mask),
            OUT_DIR / "whale-night-salute.webm",
            PREVIEW_DIR / "whale-night-salute-strip.png",
        ),
    ]

    for name, render_fn, out_path, strip_path in jobs:
        print(f"Rendering {name}...", flush=True)
        frames = render_fn()
        bytes_written = write_vp9_clip(frames, out_path)
        make_contact_sheet(frames, strip_path, name)
        print(f"Baked {name}: {len(frames)} frames ({bytes_written / 1024:.1f} KiB) -> {out_path.relative_to(ROOT)}", flush=True)

    tide_meta = rigs_and_parts["character-whale-tide"]
    tide_weights = build_body_weights(tide_meta["rig"])
    tide_bgr = cv.imread(str(CHAR_ASSETS / "whale-tide.webp"), cv.IMREAD_COLOR).astype(np.float32) / 255.0
    tide_atlas = cv.imread(str(CHAR_ASSETS / "motion" / "whale-tide.png"), cv.IMREAD_UNCHANGED).astype(np.float32) / 255.0

    print("Rendering whale-day-salute...", flush=True)
    day_frames = bake_day_salute(tide_bgr, tide_atlas, tide_meta, tide_weights, right_mask)
    day_bytes = write_vp9_clip(day_frames, OUT_DIR / "whale-day-salute.webm")
    make_contact_sheet(day_frames, PREVIEW_DIR / "whale-day-salute-strip.png", "whale-day-salute")
    print(f"Baked whale-day-salute: {len(day_frames)} frames ({day_bytes / 1024:.1f} KiB) -> public/themes/piora-flagship/performances/whale-day-salute.webm", flush=True)


if __name__ == "__main__":
    main()
