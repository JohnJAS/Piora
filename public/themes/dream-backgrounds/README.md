# Pi GUI original background slots

This directory is the stable, local-only asset root for the optional Pi GUI
background layer. `manifest.json` declares 20 final WebP assets without
coupling artwork to application code or saved user preferences.

Current status: all 20 original backgrounds are present, reviewed and marked
as available. CSS fallbacks remain in the manifest only as a resilient loading
fallback if an installation is damaged or incomplete.

Final artwork requirements:

- 16:9 landscape WebP, recommended 2560 x 1440.
- No text, logos, watermarks, recognizable people, or third-party characters.
- Quiet center area and restrained contrast so code and chat remain readable.
- Detail concentrated near the edges; no UI elements baked into the image.
- One original file for every `asset` path in `manifest.json`.
- Keep each entry's `artworkStatus` as `available` only while its reviewed file
  exists at the declared path.

The runtime never accepts remote preset URLs, scripts, HTML, or CDP injection.

## Artwork provenance and license

All 20 backgrounds were independently generated for this repository with
OpenAI's image-generation model from original text prompts. No reference
images or third-party source assets were supplied. The prompts required no
text, logos, watermarks, recognizable people, brands, characters or existing
IP. The generated images were only resized/encoded as WebP after visual review.

The piGUI contributors make these bundled background files available under
the same MIT License as the project. Generation and checksum records are kept
in this directory.
