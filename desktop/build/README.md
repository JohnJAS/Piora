# piGUI application icon

The piGUI application icon is an original project asset generated on
2026-08-01 with OpenAI's built-in image generation model. It is released under
the same MIT License as the piGUI project.

No Pi, pi-web, Codex, OpenAI, or other third-party logo, trademark, or visual
asset was used as source material. The symbol is an independent visual identity
for piGUI: a rounded application window crossed by one continuous path, evoking
conversation and code flow without drawing a literal letter.

## Files

- `icon-source-chroma.png`: original generated raster on a flat chroma-key
  background.
- `icon-transparent.png`: chroma-keyed RGBA source with edge despill.
- `icon.png`: production 1024 x 1024 transparent PNG, centered and normalized
  so the visible mark occupies 88% of the canvas.
- `icon.ico`: Windows multi-resolution icon containing 16, 24, 32, 48, 64,
  128, and 256 px RGBA images.

The same production mark is exported to `app/favicon.ico` and
`public/icons/` for the browser and installed-app surfaces. Electron Builder
uses `icon.ico` for both the unpacked Windows executable and the portable EXE.

## Generation prompt

> Use case: logo-brand
>
> Asset type: Windows desktop application icon and repository brand mark
>
> Primary request: Create an original, memorable symbol for piGUI, a calm
> modern graphical shell for a coding agent. The mark should combine the idea
> of a rounded application window or portal with one continuous flowing path
> that subtly suggests conversation, code flow, and the mathematical rhythm of
> pi without drawing a literal letter or using any text.
>
> Style/medium: crisp vector-like logo mark, flat geometric construction,
> minimal and premium
>
> Composition/framing: one centered square icon mark, strong silhouette,
> generous even padding, readable at 16px, 32px, and 256px; no surrounding
> badge mockup
>
> Color palette: deep sapphire blue and restrained luminous violet with a small
> warm pearl highlight; do not use any green in the subject
>
> Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for local
> background removal
>
> Constraints: original design only; exactly one cohesive mark; no words, no
> letters, no numbers, no trademarked symbols, no OpenAI or Codex shapes, no Pi
> product branding, no watermark; background must be one uniform #00ff00 with
> no shadow, gradient, texture, reflection, floor plane, or lighting variation;
> crisp antialiased edges; no cast shadow; no contact shadow; no transparency
> preview checkerboard
>
> Avoid: mascots, robots, brains, command prompts, angle-bracket cliches, tiny
> details, thin hairlines, 3D mockups, glossy app-store frames

The generated image was converted to transparency with the Codex image
generation skill's local chroma-key helper. The fully opaque subject pixels
remain unchanged; despill is limited to the antialiased edge. The production
PNG was then centered, resized, and exported to standard Windows icon sizes.
