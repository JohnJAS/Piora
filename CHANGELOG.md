# Changelog

All notable changes to piGUI are documented here. The project follows [Semantic Versioning](https://semver.org/) after the first tagged public release.

## [Unreleased]

### Added

- The sidebar project section reveals a `+` action on hover to open a local
  folder as a new project, and each project row reveals a `+` to start a new
  conversation in that project.
- The directory picker now surfaces sibling Windows drive roots so folders on
  other disks can be selected directly.
- The model configuration list gains one-click delete actions on provider and
  model rows (with confirmation), alongside the existing detail-view remove.
- The composer model pill moved into the input's bottom-right corner and now
  opens a Codex-style panel that combines model selection, reasoning effort,
  and compact-context controls.
- A single `+` attach button in the composer accepts both images and text
  files; file chips embed readable contents into the next message.
- A settings hub dialog is reachable from the sidebar's bottom-left model
  chip, which also hosts quick links to model, skill, plugin, appearance, and
  language settings.
- Inter is bundled locally as the interface font to match the Codex look.

### Changed

- Removed the top sidebar `New` button; creating a project now flows through
  the project section `+` entry, matching the Codex-style workspace model.
- Switching away from a project while its conversation is still responding
  asks for confirmation instead of dropping the streaming view instantly.
- Reasoning-effort and compact-context controls no longer sit in the bottom
  meta bar; they moved into the model settings panel.

## [0.1.0] - 2026-07-31

### Added

- Direct text and code editing in the right-hand file workspace, including optimistic save conflicts and external-change protection.
- Local background presets and user-selected background images, independent from the existing color themes.
- Text files open directly in Edit; source, preview, and diff remain optional views.
- Workspace project folders contain their conversations, show three recent root conversations by default, and persist expansion state.
- A discoverable appearance panel exposes theme controls and thumbnails for all 20 bundled backgrounds.
- The wide desktop shell uses restrained rounded project/chat/editor surfaces, and the Windows app integrates its web top bar with native window controls instead of showing a duplicate title row.
- Windows Electron packaging, local desktop authentication, package verification and open-source project governance.
- An optional local companion panel with Pi run status, TODOs, configurable quick phrases, and declarative Codex pet import compatibility.

### Preserved

- Pi's native session, runtime, extension, skill, package and configuration model.
- The existing conversation rendering and left-side project file tree.

### Known limitations

- Windows binaries are unsigned until a reproducible signing process is configured.
- Package installation still relies on `npm`/`npx`/Git available on the user's system.
- Native Node extension modules may require an ABI-compatible build.
