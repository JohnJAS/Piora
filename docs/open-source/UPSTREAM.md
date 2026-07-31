# Upstream projects and attribution

piGUI is being developed from open-source components. Keeping the relationships explicit helps contributors route bugs correctly and preserves the work of upstream authors.

## pi-web

- Repository: <https://github.com/agegr/pi-web>
- Role: the current web UI and server baseline from which this repository is derived
- Copyright: Copyright (c) 2026 agegr
- License: MIT

Substantial inherited files remain covered by the upstream MIT notice. When changing or redistributing those files, retain the copyright and permission notice. Where practical, reference the upstream issue or commit associated with a backport or divergence.

## Pi coding agent

- Repository: <https://github.com/earendil-works/pi>
- Role: agent, model, terminal UI, and coding-agent packages integrated by the application
- Copyright: Copyright (c) 2025 Mario Zechner
- License: MIT

Pi is an integrated dependency rather than a claim of project ownership. Its name should be used descriptively and must not imply that piGUI is an official Pi distribution.

## OpenAI Codex pet compatibility

- Repository: <https://github.com/openai/codex>
- Reviewed snapshot: `775fb21d2af9b9936618fe22dd62e6f0cb3ba4a3`
- Role: source of the pet catalog metadata, model defaults, and asset-cache conventions adapted
  by piGUI's local companion importer
- Copyright: Copyright 2025 OpenAI
- License: Apache-2.0
- Attribution bundle: [`third_party/openai-codex`](../../third_party/openai-codex/SOURCE.md)

The piGUI implementation is a modified TypeScript adaptation with separate validation, storage,
and API boundaries. It is not an official OpenAI integration. piGUI does not bundle upstream
Rust binaries, Rust source files, spritesheets, logos, or visual assets as product assets; the
user explicitly imports compatible local assets, and only the attributed TypeScript adaptation
is part of piGUI.
The complete upstream Apache-2.0 license and NOTICE are retained in the attribution bundle and
copied into packaged desktop resources.

## Independence

piGUI is independently maintained and is not endorsed by or affiliated with the upstream maintainers or OpenAI. References to Codex describe a product category or design inspiration only; they do not grant rights to the Codex name, icons, interface assets, or other OpenAI branding.

## Updating from upstream

The original pi-web repository should remain configured as an `upstream` Git remote. Upstream changes should be reviewed rather than merged blindly, with extra attention to:

- AgentSession lifecycle and fork behavior;
- session file compatibility;
- streaming and running-state reconciliation;
- file and worktree allow-lists;
- authentication and credential storage;
- package and skill execution;
- dependency and license changes.

Record meaningful divergence in pull requests or architecture notes so future rebases do not silently remove desktop security controls.
