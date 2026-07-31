# Public repository launch checklist

Status date: **2026-07-31 (Asia/Shanghai)**

This is an evidence checklist. A checked item means the repository contains the work or the
GitHub setting was confirmed; it does not imply that later package, CI, or release gates passed.

## Identity and legal

- [x] Adopt `piGUI` for the initial public preview and use original, non-affiliation-implying assets.
- [x] Use `kexijiang/pi-gui` as the public repository and update package/application metadata.
- [x] Retain the upstream `agegr` copyright and add piGUI contributor authorship in MIT `LICENSE`.
- [x] Record pi-web, Pi, project independence, and original-background attribution in `NOTICE`.
- [x] Retain the Apache-2.0 license, upstream NOTICE, immutable source links, and modification
  statement for the OpenAI Codex pet compatibility adaptation, including packaged copies.
- [x] Generate `THIRD_PARTY_LICENSES.md` deterministically from the committed npm lockfile and
  enforce freshness in CI/release checks.
- [x] Remove the unused LobeHub peer UI chain from the committed lockfile, pin reviewed MIT
  evidence for `format@0.2.2` and `khroma@2.1.0`, and fail source generation on any other runtime
  `UNDECLARED` package.
- [ ] Confirm an actual isolated build contains the build-derived exact npm package manifest,
  CycloneDX SBOM, and content-hashed license text bundle, and that `verify:package` accepts it.

## Repository configuration

- [x] Add `https://github.com/kexijiang/pi-gui.git` as `origin` and retain
  `https://github.com/agegr/pi-web.git` as `upstream`.
- [x] Configure CI and release workflows for `main` and tag-based prereleases.
- [ ] After the first push, confirm `main` as the GitHub default branch and a successful public CI run.
- [ ] Enable branch protection with the verified CI checks required for merges.
- [x] Enable private vulnerability reporting, Dependabot security updates, secret scanning, and
  push protection where available.
- [ ] Configure a dedicated private Code of Conduct reporting contact; the owner-profile fallback
  remains in effect until then.
- [ ] Decide whether GitHub Discussions are enabled and document their purpose.
- [x] Add repository topics, description, and concise support/security documentation.
- [ ] Add and visually review the GitHub social preview.
- [ ] Design and license-review an original piGUI application icon; the initial preview documents
  that it may use Electron's generic icon.

## Source and secret hygiene

- [x] Review the publishable Git history and staged release tree for credentials, tokens, private paths,
  Pi sessions, logs, generated artifacts, and developer-only fixtures.
- [x] Confirm `.gitignore` covers local auth, sessions, environment files, builds, signing
  materials, editor state, and temporary verification output.
- [x] Pin third-party GitHub Actions used by CI/release workflows to immutable commit SHAs.
- [x] Configure source checks for Windows and Linux and package checks for Windows.
- [ ] Confirm those checks pass in the public GitHub Actions environment after the source push.

## Product evidence

- [x] Preserve the conversation/Process format and left-side file tree.
- [x] Implement the right-side text editor, dirty-state protection, versioned save, and explicit
  HTTP 409 conflict flow.
- [x] Include 20 unique original background assets, a manifest, generation records, hashes, and a
  local-only selection/customization layer.
- [x] Record local source gates: typecheck passed, lint passed, and Node.js 22.19.0 tests reported
  323 passed, 0 failed, and 5 Windows symlink-permission skips out of 328 tests.
- [x] Record prior desktop/mobile browser evidence for file save, disk conflict/draft preservation,
  the retained file tree, grouped visual hierarchy, and optional companion.
- [x] Complete the final browser revalidation: default Edit and real `Ctrl+S` disk write; the
  409 continue/reload/confirmed-overwrite flow; 20 visible background thumbnails and live
  theme/background switching; project collapse; and 1440x900, 959/960px, and 390x844 layouts.
- [x] Complete an isolated production Web build, start the staged standalone service, and pass
  its `/api/health` check. This is source/Web evidence, not a Windows package result.
- [ ] Complete the packaged-EXE walkthrough for native window controls, drag/resize, the `Alt`
  menu, Window Controls Overlay safe areas, and the same critical editor/appearance flows.

## Visual and companion scope

- [x] Define and apply restrained radius, spacing, border, shadow, and surface hierarchy tokens;
  verify that primary/secondary actions and nested panels remain visually distinct.
- [x] Group related settings by workflow and remove or explain duplicate entry points.
- [x] Complete the final browser walkthrough of hierarchy, grouped controls, responsive layout,
  focus behavior, and reduced motion at 1440x900, 959/960px, and 390x844.
- [x] Implement a fully optional/closable companion that never covers chat, input, file tree,
  editor, save conflicts, or permission prompts.
- [x] Map companion task state and TODO progress to existing Pi/session data without adding a
  second Agent/SubAgent or autonomous execution path.
- [x] Make quick phrases user-configurable and route them through the normal message-send
  path before anything is sent or executed.
- [x] Build a versioned V1/V2 compatibility fixture/test matrix for known Codex local pet sources;
  include supported, rejected, replacement, and rollback cases.
- [x] Require discovery preview and explicit import confirmation; validate manifest version,
  canonical paths, regular-file status, file type/size, PNG/WebP magic and dimensions, and sprite
  atlas geometry before copying normalized resources into app-managed storage.
- [x] Prove imported resources cannot execute JavaScript, HTML, remote CSS/assets, CDP hooks, npm
  scripts, or silent network requests; use atomic replacement/rollback and leave user projects
  untouched.

## Windows and Pi extension release readiness

- [ ] Build in an isolated worktree or release environment, not the active development `.next`.
- [ ] Verify the unpacked Windows application starts, serves its health endpoint, and does not
  resolve runtime modules from the developer checkout.
- [ ] Run the synthetic Pi extension fixture against the packaged service without touching the
  user's real Pi directory.
- [ ] Test first launch, portable-folder replacement, data retention, and removal on a clean
  Windows 10/11 x64 environment.
- [x] Define the current pre-release support boundary in `SECURITY.md` and `SUPPORT.md`.
- [x] Configure tag releases to generate and re-verify SHA-256 checksums, smoke-test the final
  portable EXE, and create a draft GitHub prerelease for manual review.
- [ ] Verify an actual release artifact, checksum, release notes, unsigned status, and provenance
  before creating or announcing a GitHub Release.
- [x] Document telemetry, local storage, network behavior, extension boundaries, and the lack of
  automatic updates in the initial release.

## Public completion

- [ ] Commit and push the reviewed source tree to `main`.
- [ ] Confirm the public repository renders README assets and all relative links correctly.
- [ ] Confirm required CI passes on the pushed commit.
- [ ] Create the first honest GitHub prerelease (source-only if the Windows binary gates are not met).
- [ ] Update [PROJECT_STATUS.md](PROJECT_STATUS.md) and the
  [release goal](../RELEASE_GOAL_2026-07-31.md) with commit, CI, artifact, and Release URLs.
