# Changelog

All notable changes to Piora are documented here. The project follows [Semantic Versioning](https://semver.org/) after the first tagged public release.

## [Unreleased]

## [0.1.5] - 2026-08-12

### Changed

- The Windows portable executable now removes duplicate runtime trees and
  unused Chromium locale packs, prepares an artifact-isolated runtime cache
  once, and enforces that cached launches replace the bootstrap splash with
  the Electron-owned shell within three seconds.
- The built-in Browser workspace now matches Chromium's viewport to the panel
  size and forwards hover, pointer-button, drag, wheel, keyboard, and cursor
  feedback instead of behaving like a stretched clickable screenshot.

### Fixed

- Right-workspace tool tabs can be reordered by dragging.
- The right-workspace add-tool menu is rendered at the viewport level and
  stays fully visible when the panel or remaining screen space is narrow.
- Conversation Git line totals exclude untracked file contents while keeping
  those files visible in Review and Files.

## [0.1.4] - 2026-08-12

### Added

- Project folders can be reordered directly with a long-press drag gesture,
  and the chosen order persists across restarts without adding a separate
  drag handle.
- Review can list and safely switch between local Git branches while retaining
  uncommitted changes whenever Git can apply them.
- Destructive and unsaved-change flows now use an accessible, application-owned
  confirmation dialog instead of browser-native prompts.

### Changed

- The right workspace keeps multiple opened tool tabs available, improves the
  Review layout for large change sets, and uses more consistent panel styling.
- Clicking a project folder now selects it and toggles expansion in the same
  interaction instead of requiring a second click.
- Browser tool execution stays in the background until the user explicitly
  opens the Browser workspace.

### Fixed

- Switching conversations reliably lands at the real message bottom and stays
  anchored while Markdown, diagrams, fonts, and lazy media finish laying out.
- Unsaved editor tabs are preserved or discarded consistently when closing
  tabs and switching projects.

## [0.1.2] - 2026-08-12

### Added

- The Windows desktop process now has a reliably packaged system-tray icon
  with actions to restore Piora, start a task, inspect the running-task count,
  and quit the application completely.
- The right workspace now uses a Codex-style tool launcher and single-tool tab
  flow for Review, Terminal, Browser, and Files, including matching shortcuts,
  maximize/restore behavior, and a browser start page.

### Changed

- Closing the main desktop window now hides Piora to the system tray instead
  of stopping active sessions and the bundled local service.
- Desktop startup reuses its immediately visible shell for the real app instead
  of allocating a second Chromium window, installs the tray before the service
  is ready, reacts directly to the Next.js runtime-ready signal instead of
  waiting on a sequential cold health route, and records startup timing.
- The desktop companion now collapses into a running-task count, stays within
  its compact pet-sized window while idle, and omits the status dot and voice
  control.
- The empty conversation screen and composer no longer show obsolete starter
  prompts, package versions, or the outdated model-settings location.

## [0.1.1] - 2026-08-11

### Added

- A configurable prompt-optimizer system instruction in Agent settings, with
  local persistence, restore-default controls, and preview-before-apply flow.
- A Codex-style Browser workspace panel with interactive page frames, tabs,
  navigation controls, direct keyboard input, and a dedicated persistent Piora
  profile that keeps website sign-ins across application restarts.
- File tabs can be reordered by drag-and-drop or keyboard-accessible actions,
  closed in groups, and reopened from the tab menu or with
  `Ctrl/Cmd+Shift+T`, while preserving unsaved-change confirmation.
- Open file tabs, the active file, and expanded file-tree directories restore
  per workspace after refresh without persisting unsaved editor contents.

### Changed

- The portable desktop app now presents an immediate lightweight startup shell
  while the bundled service loads, packages with store compression for faster
  extraction, and enforces a three-second process-to-window smoke-test budget.

### Fixed

- Selected projects and sessions use a neutral Codex-style highlight without
  the previous blue accent rail.
- Review diffs start collapsed and expand independently instead of opening all
  files when one file is selected.
- Desktop companion bubbles stay close to the pet when idle and stack active
  task bubbles above the base status bubble.
- Review and diff typography now follows the configured UI font scale.

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
