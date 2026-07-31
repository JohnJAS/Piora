# Changelog

All notable changes to piGUI are documented here. The project follows [Semantic Versioning](https://semver.org/) after the first tagged public release.

## [Unreleased]

- Text files now open directly in the right-side editor; source, preview, and diff remain optional views.
- The sidebar now groups conversations under workspace project folders, shows three recent root conversations by default, and persists expand/collapse state.
- Appearance is a discoverable sidebar action with theme controls and a thumbnail grid for all 20 bundled backgrounds.
- The wide desktop shell uses restrained rounded project/chat/editor surfaces, and the Windows app integrates its web top bar with native window controls instead of showing a duplicate `piGUI` title row.

## [0.1.0] - 2026-07-31

### Added

- Direct text and code editing in the right-hand file workspace, including optimistic save conflicts and external-change protection.
- Local background presets and user-selected background images, independent from the existing color themes.
- Windows Electron packaging, local desktop authentication, package verification and open-source project governance.
- An optional local companion panel with Pi run status, TODOs, configurable quick phrases, and declarative Codex pet import compatibility.

### Preserved

- Pi's native session, runtime, extension, skill, package and configuration model.
- The existing conversation rendering and left-side project file tree.

### Known limitations

- Windows binaries are unsigned until a reproducible signing process is configured.
- Package installation still relies on `npm`/`npx`/Git available on the user's system.
- Native Node extension modules may require an ABI-compatible build.
