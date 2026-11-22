"""Render 晴汐's continuous terrace performance for the desktop wallpaper.

    python scripts/bake-character-walk.py --rife PATH/TO/rife-ncnn-vulkan --model PATH/TO/rife-v4.6

Use --poses to reuse a directory containing the two baked action sequences.
The clients layer the transparent actor WebM over the lossless still stage.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import cv2 as cv
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "scripts/character-performances/whale-tide"
PUBLIC = ROOT / "public/themes/character-backgrounds"
sys.path.insert(0, str(ART))

FPS = 60
WIDTH, HEIGHT = 1920, 1080
CUP_FRAMES = 128
BOOKEND_FRAMES = 16


def read_cels(directory):
    paths = sorted(directory.glob("[0-9][0-9][0-9][0-9].png"))
    if not paths or any(int(path.stem) != index for index, path in enumerate(paths)):
        raise ValueError(f"Expected consecutive, zero-based PNG frames in {directory}")
    return paths


def read_actor(path):
    actor = cv.imread(str(path), cv.IMREAD_UNCHANGED)
    if actor is None or actor.ndim != 3 or actor.shape[2] != 4:
        raise ValueError(f"Expected a transparent character cel at {path}")
    return actor


def dance(poses):
    from camera_scene import START, SCALE, foreground

    gait = json.loads((poses / "gait/index.json").read_text(encoding="utf-8-sig"))
    anchor = tuple(gait["anchor"])
    if gait["fps"] != FPS or not np.isclose(SCALE, gait["scale"]):
        raise ValueError("The walking cels and the stage must use the same timing and scale")
    center = read_cels(poses / "center")
    turn = json.loads((poses / "center/timeline.json").read_text(encoding="utf-8"))
    if turn["fps"] != FPS or turn["frames"] != len(center):
        raise ValueError("The turn must supply a pose at every output frame")
    turn_offset = gait["phases"]["out"][-1]["dx"]
    if not np.isclose(turn_offset, gait["phases"]["back"][0]["dx"]):
        raise ValueError("The turn and return walk must share a floor position")
    turn_x = START + turn_offset * SCALE
    for phase in ("out", "center", "back"):
        if phase == "center":
            for path in center:
                yield phase, foreground(read_actor(path), turn_x, anchor=anchor)
            continue
        paths = read_cels(poses / "gait" / phase)
        rows = gait["phases"][phase]
        if len(rows) != len(paths):
            raise ValueError(f"Missing root positions for {phase}")
        for index, (path, row) in enumerate(zip(paths, rows)):
            if row["frame"] != index or row["dy"] != 0:
                raise ValueError(f"Unexpected gait registration at {path}")
            x = START + row["dx"] * SCALE
            yield phase, foreground(read_actor(path), x, anchor=anchor)


def cup_gesture(reverse=False):
    from camera_scene import gesture_foreground

    for frame in range(CUP_FRAMES):
        t = frame / (CUP_FRAMES - 1)
        yield gesture_foreground(1 - t if reverse else t)


def bake(poses, output, timeline):
    from camera_scene import gesture_foreground, stage

    original = gesture_foreground(0)
    output.parent.mkdir(parents=True, exist_ok=True)
    counts = {}
    with TemporaryDirectory(dir=output.parent) as tmp:
        staging = Path(tmp) / "performance.webm"
        plate_path = Path(tmp) / "whale-tide-stage.webp"
        if not cv.imwrite(str(plate_path), stage(), [cv.IMWRITE_WEBP_QUALITY, 101]):
            raise OSError(f"Could not save {plate_path}")
        cmd = ["ffmpeg", "-nostdin", "-v", "error", "-f", "rawvideo", "-pixel_format", "bgra",
               "-video_size", f"{WIDTH}x{HEIGHT}", "-framerate", str(FPS), "-i", "pipe:0",
               "-an", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "18",
               "-row-mt", "1", "-tile-columns", "2", "-threads", "8", "-cpu-used", "4", "-g", str(FPS * 2), str(staging)]
        with subprocess.Popen(cmd, stdin=subprocess.PIPE) as encoder:
            def write(phase, frame):
                if frame.shape != (HEIGHT, WIDTH, 4) or frame.dtype != np.uint8:
                    raise ValueError(f"Invalid transparent actor in {phase}")
                encoder.stdin.write(np.ascontiguousarray(frame).tobytes())
                counts[phase] = counts.get(phase, 0) + 1

            try:
                for _ in range(BOOKEND_FRAMES):
                    write("portrait", original)
                for frame in cup_gesture():
                    write("putDown", frame)
                for phase, frame in dance(poses):
                    write(phase, frame)
                for frame in cup_gesture(reverse=True):
                    write("pickUp", frame)
                for _ in range(BOOKEND_FRAMES):
                    write("portraitEnd", original)
            finally:
                encoder.stdin.close()
            if encoder.wait():
                raise RuntimeError("FFmpeg could not encode the terrace performance")
        plate_path.replace(output.with_name(plate_path.name))
        staging.replace(output)
    if timeline:
        offset, phases = 0, {}
        for phase, count in counts.items():
            phases[phase] = {"startFrame": offset, "frames": count}
            offset += count
        timeline.parent.mkdir(parents=True, exist_ok=True)
        timeline.write_text(json.dumps({"fps": FPS, "phases": phases}, indent=2), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=PUBLIC / "performances/whale-tide-actor.webm")
    parser.add_argument("--poses", type=Path, help="Use pre-rendered gait and center directories")
    parser.add_argument("--rife", type=Path, help="Path to the RIFE ncnn executable for cel interpolation")
    parser.add_argument("--model", type=Path, help="Path to the rife-v4.6 model directory")
    parser.add_argument("--timeline", type=Path, help="Write shot timing for visual inspection")
    args = parser.parse_args()
    if args.poses:
        bake(args.poses.resolve(), args.output.resolve(), args.timeline)
        return
    with TemporaryDirectory() as tmp:
        poses = Path(tmp)
        for recipe, dest in ((ART / "gait.py", "gait"), (ART / "center/render.py", "center")):
            cmd = [sys.executable, str(recipe), "--output", str(poses / dest)]
            if args.rife:
                cmd.extend(["--rife", str(args.rife.resolve())])
            if args.model:
                cmd.extend(["--model", str(args.model.resolve())])
            subprocess.run(cmd, check=True)
        bake(poses, args.output.resolve(), args.timeline)


if __name__ == "__main__":
    main()
