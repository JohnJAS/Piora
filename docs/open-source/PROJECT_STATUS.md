# Open-source project status

Status date: **2026-08-01 (Asia/Shanghai)**

## Identity and repository

The first public preview uses the name **Piora** and the repository
[`kexijiang/piora`](https://github.com/kexijiang/piora). Package metadata and the Windows
application identity use that repository and the application ID `io.github.kexijiang.piora`.
The public repository has been created and the local checkout has both `origin` and the retained
`agegr/pi-web` `upstream` remote.

Piora is independently maintained. It is not an official application from agegr,
earendil-works, OpenAI, or Codex, and it must not use their trademarks or artwork in a way that
implies endorsement.

## Implemented in the current working tree

- the existing Pi conversation and Process rendering, session format, runtime, tools, skills,
  extensions, packages, and left-side file tree remain the product foundation;
- ordinary text files open directly in the right-side Edit mode, while Source, Preview, and Diff
  remain available alongside dirty-state protection, keyboard save, version-aware writes, and
  explicit disk-conflict handling;
- file writes are constrained to authorized roots and ordinary bounded UTF-8 text, with content
  hashes, HTTP 409 conflicts, symlink/path checks, file locking, and atomic replacement;
- five color themes remain available, with a separate local-only background layer, readability
  controls, custom-image persistence, and reset behavior;
- 20 original WebP backgrounds, their manifest, generation records, hashes, and overview image
  are present in the repository;
- restrained radius, spacing, border, shadow, and surface tokens now give the shell a clearer
  Codex-inspired hierarchy, while related appearance, session/model, composer, and editor controls
  are grouped by workflow;
- conversations are grouped inside workspace project folders; each project shows three recent root
  conversation chains by default and persists project/session expansion state;
- the Windows desktop shell hides the duplicate native title row and uses native Window Controls
  Overlay with a safe draggable web title strip instead of reimplementing system window buttons;
- an optional, closable companion dock displays existing Pi/session status, TODO progress, and
  user-configured quick phrases through the normal message-send path; it does not create another
  Agent/SubAgent or autonomous execution path;
- known local Codex pets can be discovered, previewed, and explicitly imported from the current
  pets directory, legacy avatars directory, and built-in `tui-pets` cache. The importer supports
  declarative V1/V2 PNG/WebP sprite resources, copies only normalized data into Piora-managed
  storage, and uses atomic replacement with rollback;
- an Electron shell, local token-authenticated standalone service, Windows packaging
  configuration, CI, and prerelease workflow are present;
- Pi's own resource loader remains responsible for extensions. Piora does not add a separate
  SubAgent or plugin product model.
- interface font family and user-entered size now cover the complete GUI while code remains on a
  dedicated monospaced stack; the standalone `Piora` chrome label and completion tone were removed,
  with an opt-in native/browser completion notification replacing the latter;
- the conversation header exposes a restrained project menu, and model settings expose real
  availability tests through the current trusted Pi runtime without bypassing extension providers;
- historical Pi reasoning retains its raw content-block index and can recover from rapid
  collapse/reopen, request timeout, and live-message reconciliation instead of remaining on a
  loading placeholder.

## Verification recorded so far

- `npm run typecheck`: passed for the web and desktop TypeScript projects;
- `npm run lint`: passed;
- `npm test` under the required Node.js 22.19.0 runtime: 380 tests, 375 passed, 0 failed,
  5 skipped because Windows did not grant symlink-creation privileges;
- `npm run licenses:check` and `npm run verify:backgrounds` passed; the latter verified 20 unique
  WebP assets totaling 2,274,482 bytes. `npm audit --omit=dev --audit-level=high` against the
  official npm registry reported zero vulnerabilities;
- `npm run verify:backgrounds`: passed for 20 unique manifest-linked images totaling 2,274,482
  bytes, each decodable, at least 1600x900, 16:9, and below the per-file limit;
- focused front-end and back-end tests cover companion state/TODO/phrases, optional visibility,
  Codex local-pet discovery/preview/import, V1/V2 fixtures, atomic replacement/rollback, and
  rejection of unknown, traversal, symlink, script, and remote-resource inputs;
- an isolated production Web build passed, the staged standalone service started, and
  `/api/health` returned successfully;
- an isolated Windows package build passed. `verify:package` confirmed the Electron shell, 20
  backgrounds, token-authenticated health/root/session routes, packaged-Electron runtime isolation,
  and a synthetic external Pi package exposing an extension command, tool, and Skill, while finding
  zero Piora-owned SubAgent features;
- the package contains a v3 exact package inventory and CycloneDX 1.5 SBOM covering 101 packaged
  copies plus 565 runtime-source packages (666 components total) and 224 content-hashed license
  texts;
- the portable first-run smoke test passed with isolated user data, a healthy bundled service,
  loaded renderer, ready preload bridge, and ready AppShell;
- the real unpacked EXE showed no duplicate operating-system title/menu row. Its integrated top
  strip performed the native double-click maximize action, native restore and close worked, and
  the appearance control opened the bundled theme/background panel;
- ASAR and staged-renderer probes confirmed the packaged `hidden` title style, native overlay,
  transparent title color, auto-hidden menu, desktop-only runtime marker, drag/no-drag CSS, and
  native-control safe-area variables are the same bytes as the reviewed build output;
- synthetic desktop automation did not expose a window-coordinate change after continuous dragging.
  Native double-click maximize strongly confirms Windows treated the blank point as a caption area,
  but standard-mouse continuous drag remains part of the clean-machine matrix rather than being
  overstated as complete;
- the local candidate `Piora-0.1.0-win-x64-portable.exe` is 180,907,440 bytes with SHA-256
  `6461C3D0ECE8F55F7CA50F67155CE03B56B509D58B2111ECC62D0FD6982229FF`; its Authenticode
  status is `NotSigned`;
- an artifact string scan found no developer-home or development-checkout private build paths. High-confidence
  token-pattern candidates were confined to upstream binary byte sequences, Next.js identifiers,
  and a dependency documentation marker rather than stored credentials;
- the final browser walkthrough passed at 1440x900, the 959/960px breakpoint, and 390x844:
  text opened in Edit, `Ctrl+S` wrote to disk, the 409 continue/reload/confirmed-overwrite flow
  preserved user intent, all 20 background thumbnails rendered and switched with themes, project
  collapse worked, and desktop/mobile rounded or overlay layouts matched their intended modes.

These results verify the source implementation and the locally built unsigned Windows candidate.
They are **not** a claim that clean-machine Windows coverage, public CI, or the public GitHub
prerelease has already passed.

## Visual and companion compatibility boundary

The Codex-inspired work aligns interaction hierarchy, not Codex branding or pixel-for-pixel
artwork. The companion remains a small optional surface around existing Pi behavior. Current
compatibility is intentionally limited to the tested V1/V2 declarative sprite formats and known
local Codex resource locations; it is not a claim that arbitrary third-party packages can run.

Import requires a visible preview and an explicit user action. Manifest version, canonical local
paths, regular-file status, bounded file size, PNG/WebP magic and dimensions, and sprite-atlas
geometry are validated before normalized resources reach app-managed storage. Unknown versions,
path traversal, symlinks, scripts, HTML/CSS/CDP hooks, install commands, and remote resources are
rejected instead of executed or fetched.

## Still pending before release completion

- clean-machine manual coverage for continuous window dragging, edge/corner resize, the transient
  `Alt` menu, 100/125/150% DPI scaling, portable-folder movement, and the full editor conflict flow;
  the current packaged EXE evidence covers the integrated top row, double-click maximize,
  restore/close, and the appearance panel;
- clean-machine portable replacement, data-retention, and uninstall checks;
- the current final working-tree batch still needs an isolated package rebuild, reviewed PR into
  `main`, its own public CI result, and GitHub Release download/checksum verification. The public
  repository, default `main`, and prior successful Ubuntu/Windows CI are already established;
- branch protection/rulesets remain an administrative hardening task and are not yet enabled.

Until those items are recorded, the locally produced executable is an unsigned prerelease
candidate, not an official stable release. Track the detailed acceptance record in
[the release goal](../RELEASE_GOAL_2026-07-31.md) and the administrative gates in
[the public launch checklist](LAUNCH_CHECKLIST.md).

## License

Project code is released under the MIT License. Contributions accepted into this repository are
licensed on the same terms. Upstream and third-party components retain their own copyright and
license notices; see [`LICENSE`](../../LICENSE), [`NOTICE`](../../NOTICE),
[`THIRD_PARTY_LICENSES.md`](../../THIRD_PARTY_LICENSES.md), and [UPSTREAM.md](UPSTREAM.md).
