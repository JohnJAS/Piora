# Changelog

All notable changes to Piora are documented here. The project follows [Semantic Versioning](https://semver.org/) after the first tagged public release.

## [Unreleased]

### Added

- File tabs can be reordered by drag-and-drop or keyboard-accessible actions,
  closed in groups, and reopened from the tab menu or with
  `Ctrl/Cmd+Shift+T`, while preserving unsaved-change confirmation.
- Open file tabs, the active file, and expanded file-tree directories restore
  per workspace after refresh without persisting unsaved editor contents.

## [0.1.0] - 2026-08-01

### Added

- An original Piora application mark with transparent PNG and multi-resolution
  Windows ICO assets, wired into the portable Electron executable and matching
  browser/PWA icons, with generation and MIT-license provenance retained in the
  repository.
- The sidebar project section reveals a `+` action on hover to open a local
  folder as a new project, and each project row reveals a `+` to start a new
  conversation in that project.
- The directory picker now surfaces sibling Windows drive roots so folders on
  other disks can be selected directly.
- Model settings can hide an entire built-in or extension-provided channel and
  restore it from the Add Provider panel. Custom providers can still be
  deleted and configured again, while stored API-key/OAuth credentials have a
  separate confirmed "Remove configuration" action.
- The composer model pill moved into the input's bottom-right corner and now
  opens a Codex-style panel that combines model selection, reasoning effort,
  and compact-context controls.
- A single `+` attach button in the composer accepts both images and text
  files; file chips embed readable contents into the next message.
- A settings hub dialog is reachable from the sidebar's bottom-left model
  chip, which also hosts quick links to model, skill, plugin, appearance, and
  language settings.
- Appearance settings include app-wide interface-font choices and the existing
  color/background presets. The selected interface font covers the sidebar,
  top bar, chat, composer, settings, and file workspace; code remains on a
  dedicated monospaced stack.
- Model settings expose an explicit availability test for every loaded Pi,
  OAuth, API-key, extension, and custom model, with latency, HTTP status, and
  actionable failure details.
- CI and tag releases enforce a redacting release-hygiene scan for sensitive
  files, private absolute paths, and high-confidence credentials.
- The conversation header's project name opens a Codex-style project menu for
  starting a task in the current folder, switching projects through the safe
  directory picker, copying the working path, and revealing projects/files.
- Direct text and code editing in the right-hand file workspace, including
  optimistic save conflicts and external-change protection.
- Local background presets and user-selected background images, independent
  from the existing color themes.
- Text files open directly in Edit; source, preview, and diff remain optional
  views.
- Workspace project folders contain their conversations, show three recent
  root conversations by default, and persist expansion state.
- A discoverable appearance panel exposes theme controls and thumbnails for
  all 20 bundled backgrounds.
- The wide desktop shell uses restrained rounded project/chat/editor surfaces,
  and the Windows app integrates its web top bar with native window controls
  instead of showing a duplicate title row.
- Windows Electron packaging, local desktop authentication, package
  verification and open-source project governance.
- An optional local companion panel with Pi run status, TODOs, configurable
  quick phrases, and declarative Codex pet import compatibility.

### Changed

- Removed the top sidebar `New` button; creating a project now flows through
  the project section `+` entry, matching the Codex-style workspace model.
- Removed the sidebar refresh button, the redundant Open project dropdown, and
  the low-value Open repository root action. Project creation is handled by
  the projects-section `+`.
- Aligned the default interface typography with Codex on Windows: the system
  UI font stack renders at 14px, while chat content uses a compact 22px line
  height without scaling panel geometry.
- Switching away from a project while its conversation is still responding
  asks for confirmation instead of dropping the streaming view instantly.
- Reasoning-effort and compact-context controls no longer sit in the bottom
  meta bar; they moved into the model settings panel.
- Removed the standalone `Piora` label from the upper-left application chrome
  and aligned the right file-workspace toggle with both the closed top bar and
  the open file-tab strip, including the Electron safe area.
- The custom text-size setting now scales navigation, project/session rows,
  the file tree, top bar, settings, chat, and the complete right file workspace
  instead of affecting only conversation text.
- Historical reasoning blocks preserve their raw Pi block index, isolate
  in-flight loads by session/entry, time out safely, and recover from rapid
  collapse/reopen or live-message reconciliation without remaining stuck on a
  loading placeholder.

### Preserved

- Pi's native session, runtime, extension, skill, package and configuration model.
- The existing conversation rendering and left-side project file tree.

### Known limitations

- Windows binaries are unsigned until a reproducible signing process is configured.
- Package installation still relies on `npm`/`npx`/Git available on the user's system.
- Native Node extension modules may require an ABI-compatible build.
