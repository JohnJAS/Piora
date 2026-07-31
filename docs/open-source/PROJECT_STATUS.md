# Open-source project status

Status date: **2026-07-31 (Asia/Shanghai)**

## Identity and repository

The first public preview uses the name **piGUI** and the repository
[`kexijiang/pi-gui`](https://github.com/kexijiang/pi-gui). Package metadata and the Windows
application identity use that repository and the application ID `io.github.kexijiang.pigui`.
The public repository has been created and the local checkout has both `origin` and the retained
`agegr/pi-web` `upstream` remote.

piGUI is independently maintained. It is not an official application from agegr,
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
  declarative V1/V2 PNG/WebP sprite resources, copies only normalized data into piGUI-managed
  storage, and uses atomic replacement with rollback;
- an Electron shell, local token-authenticated standalone service, Windows packaging
  configuration, CI, and prerelease workflow are present;
- Pi's own resource loader remains responsible for extensions. piGUI does not add a separate
  SubAgent or plugin product model.

## Verification recorded so far

- `npm run typecheck`: passed for the web and desktop TypeScript projects;
- `npm run lint`: passed;
- `npm test` under the required Node.js 22.19.0 runtime: 328 tests, 323 passed, 0 failed,
  5 skipped because Windows did not grant symlink-creation privileges;
- `npm run verify:backgrounds`: passed for 20 unique manifest-linked images totaling 2,274,482
  bytes, each decodable, at least 1600x900, 16:9, and below the per-file limit;
- focused front-end and back-end tests cover companion state/TODO/phrases, optional visibility,
  Codex local-pet discovery/preview/import, V1/V2 fixtures, atomic replacement/rollback, and
  rejection of unknown, traversal, symlink, script, and remote-resource inputs;
- earlier browser evidence for save/conflict and companion behavior remains useful, but the final
  1440x900, 390x844, reopened editor/appearance/project-folder walkthrough and integrated EXE title
  bar verification are pending after the latest UI corrections.

These results verify the source implementation. They are **not** a claim that a distributable
Windows executable or public release has passed all gates.

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

- isolated Windows package build, startup/health check, and synthetic Pi extension fixture;
- final browser and packaged-EXE walkthrough of direct editing, appearance/background selection,
  project folders with three-item overflow, rounded surfaces, and native window-control safe areas;
- clean-machine portable replacement, data-retention, and uninstall checks;
- review of generated release artifacts for secrets and private developer paths (the current
  worktree and one-commit repository history scan found no credential signatures or private paths);
- artifact-level third-party license audit. The unused LobeHub peer UI chain is absent from the
  committed lockfile, `format@0.2.2` and `khroma@2.1.0` have hash-pinned reviewed MIT evidence,
  and runtime `UNDECLARED` entries now fail source generation; the binary manifest/SBOM must still
  prove the same closure for the actual artifact;
- first source commit/push, public CI result, branch protection, and GitHub Release.

Until those items are recorded, any locally produced executable is an unsigned development
artifact, not an official stable release. Track the detailed acceptance record in
[the release goal](../RELEASE_GOAL_2026-07-31.md) and the administrative gates in
[the public launch checklist](LAUNCH_CHECKLIST.md).

## License

Project code is released under the MIT License. Contributions accepted into this repository are
licensed on the same terms. Upstream and third-party components retain their own copyright and
license notices; see [`LICENSE`](../../LICENSE), [`NOTICE`](../../NOTICE),
[`THIRD_PARTY_LICENSES.md`](../../THIRD_PARTY_LICENSES.md), and [UPSTREAM.md](UPSTREAM.md).
