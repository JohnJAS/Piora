# OpenAI Codex attribution

piGUI's companion compatibility layer contains a modified TypeScript adaptation of a small
part of the OpenAI Codex TUI pet implementation. It mirrors the built-in pet catalog metadata,
default frame and animation timing conventions, and local asset-cache path conventions needed
to discover and safely import a user's existing Codex pets.

Upstream snapshot reviewed: `775fb21d2af9b9936618fe22dd62e6f0cb3ba4a3`

- Repository: <https://github.com/openai/codex>
- Catalog source: <https://github.com/openai/codex/blob/775fb21d2af9b9936618fe22dd62e6f0cb3ba4a3/codex-rs/tui/src/pets/catalog.rs>
- Model source: <https://github.com/openai/codex/blob/775fb21d2af9b9936618fe22dd62e6f0cb3ba4a3/codex-rs/tui/src/pets/model.rs>
- Asset-pack source: <https://github.com/openai/codex/blob/775fb21d2af9b9936618fe22dd62e6f0cb3ba4a3/codex-rs/tui/src/pets/asset_pack.rs>
- Upstream license: Apache License 2.0
- Upstream copyright: Copyright 2025 OpenAI

The adaptation is not an official OpenAI integration. It was rewritten for piGUI's local-only,
declarative import model and adds independent validation, normalization, storage, and API logic.
No upstream Rust binaries, Rust source files, spritesheets, logos, or other visual assets are
bundled as product assets by piGUI; only the attributed, modified TypeScript adaptation is part
of piGUI. Compatible visual assets are read from a user's local Codex installation only when requested.
The names `OpenAI` and `Codex` are used solely to identify compatibility and source origin.

The complete upstream Apache-2.0 license and NOTICE text are reproduced in this directory.
