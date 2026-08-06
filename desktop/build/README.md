# Piora application icon

Piora uses an original project asset: a mathematical pi mark designed for this project. The
public name combines **Pi** with **Aurora**: a compact reference to the Pi agent
runtime and to ideas becoming visible.

The production icon is released under the same MIT License as the project. It
does not reuse the Pi, Codex, OpenAI, or any other third-party logo or visual
asset.

## Design

The mark is a literal pi silhouette drawn as three calm ribbon strokes. Warm
ivory moves through ultraviolet into cyan against a midnight-indigo field. A
simple silhouette, wide counters, and heavy strokes keep the mark recognizable
at Windows taskbar sizes; subtle highlights are reserved for larger surfaces.

## Files

- `piora-icon.svg`: editable, deterministic source of truth.
- `icon.png`: 1024 x 1024 production PNG.
- `icon.ico`: Windows icon with 16, 24, 32, 48, 64, 128, and 256 px PNG frames.
- `icon-transparent.png`: compatibility copy used by older project tooling.
- `icon-source-chroma.png`: archived source of the retired piGUI icon; not used.

`npm run brand:icons` regenerates the production PNG/ICO files, the browser
favicon, and PWA icons. Electron Builder uses `icon.ico` for unpacked and
portable Windows executables.

## Design brief

> Use case: logo-brand
>
> Asset type: Windows desktop application icon and product brand mark
>
> Primary request: Create an original, refined icon centered on the
> mathematical symbol pi for a modern AI coding workspace named Piora. The mark
> should feel artistic, calm, premium, and memorable.
>
> Style/medium: vector-friendly logo mark with a crisp geometric silhouette
> and restrained luminous color transitions
>
> Composition/framing: one large centered pi symbol, optically balanced with
> generous padding, recognizable at 16 px and 32 px
>
> Color palette: midnight indigo, warm ivory, ultraviolet, and a small cyan
> highlight
>
> Constraints: no text, no browser-window motif, no traffic-light dots, no
> chat bubble, no robot, no code brackets, no watermark, no tiny details

The built-in image-generation route was attempted first but did not return a
result. The final asset therefore uses a deterministic project-native SVG,
which provides exact geometry and repeatable multi-resolution exports.
