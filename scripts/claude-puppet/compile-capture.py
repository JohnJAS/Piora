"""Package the real frames emitted by a Claude desktop QA scenario."""

from argparse import ArgumentParser
from bisect import bisect_right
import json
import math
from pathlib import Path

import cv2
from PIL import Image, ImageChops, ImageDraw, ImageStat


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def encode_recording(directory):
    source = directory / "recording-frames"
    timing = read_json(source / "timing.json")
    frames = timing["frames"]
    times = [frame["at"] for frame in frames]
    seconds = (times[-1] - times[0]) / 1000
    fps = 30
    count = round(seconds * fps)
    first = cv2.imread(str(source / frames[0]["filename"]))
    height, width = first.shape[:2]
    size = (width - width % 2, height - height % 2)
    gate = timing.get("gate")
    scene = gate.get("scene", "paper") if gate else "paper"
    output = directory / f"claude-{scene}-actual.mp4"
    writer = cv2.VideoWriter(str(output), cv2.VideoWriter_fourcc(*"mp4v"), fps, size)
    if not writer.isOpened():
        raise RuntimeError("Unable to open the local MP4 encoder")
    used = set()
    held = []
    cached = first
    last = 0
    try:
        for index in range(count):
            # Use the most recent real frame and hold it across capture gaps.
            frame = bisect_right(times, times[0] + index * 1000 / fps) - 1
            if frame != last:
                cached = cv2.imread(str(source / frames[frame]["filename"]))
            elif index:
                held.append(round(index / fps * 1000, 3))
            if cached is None:
                raise RuntimeError(f"Cannot decode recorded frame {frame}")
            writer.write(cached[:size[1], :size[0]])
            last = frame
            used.add(frame)
    finally:
        writer.release()

    reader = cv2.VideoCapture(str(output))
    try:
        if not reader.isOpened() or int(reader.get(cv2.CAP_PROP_FRAME_COUNT)) != count:
            raise RuntimeError("Encoded recording could not be reopened")
    finally:
        reader.release()
    result = {
        "file": str(output.resolve()),
        "scene": scene,
        "recordedSeconds": seconds,
        "firstSourceAtEpochMs": times[0],
        "lastSourceAtEpochMs": times[-1],
        "captureStartedAtEpochMs": timing["started"],
        "captureEndedAtEpochMs": timing["ended"],
        "durationSeconds": count / fps,
        "encodingFps": fps,
        "size": size,
        "sourceFrames": len(frames),
        "outputFrames": count,
        "distinctSourcesInOutput": len(used),
        "heldOutputFrames": count - len(used),
        "heldOffsetsMs": held,
        "timing": timing["summary"],
        "states": [{"state": cue["state"], "offsetMs": cue["at"] - times[0]} for cue in timing["cues"]],
    }
    if gate:
        result["states"] = [{
            "state": row["state"], "trigger": row["trigger"], "cueAtEpochMs": row["cueAt"],
            "firstRenderedAtEpochMs": row["firstAt"], "lastRenderedAtEpochMs": row["lastAt"],
            "offsetMs": row["firstAt"] - times[0], "lastOffsetMs": row["lastAt"] - times[0],
            "renderSamples": row["samples"], "sourceFrames": row["sourceFrames"],
        } for row in gate["spans"]]
        result["click"] = gate["click"]
        result["renderedMotion"] = {key: value for key, value in gate.items() if key not in {"spans", "click"}}
    (directory / "recording-check.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


def gesture_sheet(directory):
    folder = directory / "gesture-keyframes"
    data = read_json(folder / "index.json")
    frames = data["transitions"]
    if len(frames) != 12:
        raise ValueError("The sheet requires all 12 ordered gesture transitions")
    width, height = 320, 250
    page = Image.new("RGB", (width * len(frames[0]["frames"]), height * len(frames)), "#201d1c")
    draw = ImageDraw.Draw(page)
    for row, transition in enumerate(frames):
        for col, frame in enumerate(transition["frames"]):
            x, y = col * width, row * height
            draw.text((x + 5, y + 5),
                      f"{transition['from']} to {transition['to']} / {frame['elapsedMs']:.0f} ms", fill="white")
            with Image.open(folder / frame["filename"]) as shot:
                shot.thumbnail((width - 10, height - 24))
                page.paste(shot, (x + 5, y + 21))
    page.save(directory / "gesture-transitions.png")


def ordered_preview_sheet(directory, result):
    rows = read_json(directory / "runtime-during-capture.json")["observed"]["samples"]
    idle = [row for row in rows if row["state"] == "idle"]
    stream = [row for row in rows if row["state"] == "streaming"]
    greet = [row for row in rows if row["state"] == "greet" and row["hand"][3] > 0.98]
    before_click = next(row for row in reversed(rows) if row["state"] == "sleepy")
    tile_width, tile_height = 420, 246
    sheet = Image.new("RGB", (tile_width * 3, tile_height * 3), "#201d1c")
    draw = ImageDraw.Draw(sheet)
    reader = cv2.VideoCapture(result["file"])
    scene = result["scene"]

    def decode(sample):
        offset = (sample["at"] - result["firstSourceAtEpochMs"]) / 1000
        index = max(0, min(result["outputFrames"] - 1, math.ceil(offset * result["encodingFps"])))
        reader.set(cv2.CAP_PROP_POS_FRAMES, index)
        ok, image = reader.read()
        if not ok:
            raise RuntimeError(f"Cannot read recorded frame {index}")
        return Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB)), index / result["encodingFps"]

    def extract(shot, box):
        return shot.crop(tuple(round(ratio * axis) for ratio, axis in zip(box, (*shot.size, *shot.size))))

    try:
        raised = greet[0]
        wave_box = (0.70, 0.07, 0.97, 0.49) if scene != "paper" else (0.76, 0.12, 0.89, 0.45)
        raised_arm = extract(decode(raised)[0], wave_box)

        def wave_change(sample):
            next_arm = extract(decode(sample)[0], wave_box)
            return sum(ImageStat.Stat(ImageChops.difference(raised_arm, next_arm)).mean)

        swung = max(greet[1::4], key=wave_change)
        mouth_frames = [
            ("Streaming / closing", max(stream, key=lambda row: row["mouth"][0])),
            ("Streaming / half-open", max(stream, key=lambda row: row["mouth"][1])),
            ("Streaming / open", max(stream, key=lambda row: row["mouth"][2])),
        ]
        idle_frames = [
                ("Idle / rest", idle[0]),
                ("Idle / page lifted", max(idle, key=lambda row: row["pageLift"])),
                ("Idle / story settled", idle[-1]),
        ]
        if scene == "lamp":
            idle_frames = [
                ("Idle / warm lamp", max(idle, key=lambda row: row["glow"])),
                ("Idle / book lifted", max(idle, key=lambda row: row["carry"])),
                ("Idle / book set down", idle[-1]),
            ]
        elif scene == "autumn":
            idle_frames = [
                ("Idle / chin and leaves", max(idle, key=lambda row: row["hand"][2])),
                ("Idle / writing", max(idle, key=lambda row: math.hypot(*row["wrist"]))),
                ("Idle / page lifted", max(idle, key=lambda row: row["pageLift"])),
            ]
        mouth_box = {"paper": (0.684, 0.077, 0.84, 0.31), "lamp": (0.71, 0.07, 0.90, 0.37),
                     "autumn": (0.64, 0.07, 0.85, 0.35)}[scene]
        groups = [
            ((0.46, 0.13, 0.998, 0.68), idle_frames),
            (mouth_box, sorted(mouth_frames, key=lambda frame: frame[1]["at"])),
            ((0.56, 0.05, 0.99, 0.60), [
                ("Sleepy / before click", before_click),
                ("Greet / raised hand", raised),
                ("Greet / arm swings", swung),
            ]),
        ]
        for y, (box, frames) in enumerate(groups):
            for x, (caption, sample) in enumerate(frames):
                shot, seconds = decode(sample)
                clipped = extract(shot, box)
                clipped.thumbnail((tile_width - 10, tile_height - 24))
                draw.text((x * tile_width + 5, y * tile_height + 5),
                          f"{caption}  {seconds:.2f}s", fill="white")
                sheet.paste(clipped, (x * tile_width + 5, y * tile_height + 21))
    finally:
        reader.release()
    sheet.save(directory / "ordered-motion-proof.png")


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path, help="Desktop scenario evidence directory")
    args = parser.parse_args()
    result = encode_recording(args.run)
    if "renderedMotion" in result:
        ordered_preview_sheet(args.run, result)
    if (args.run / "gesture-keyframes" / "index.json").is_file():
        gesture_sheet(args.run)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
