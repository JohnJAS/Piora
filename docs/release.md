# piGUI release procedure

The piGUI release process is configured to publish source code and an unsigned Windows x64 portable application from
[`kexijiang/pi-gui`](https://github.com/kexijiang/pi-gui). It does not publish the former
`@agegr/pi-web` npm package.

## Prerequisites

- Node.js `22.19.0` (see `.nvmrc`).
- A clean reviewed commit on `main`.
- No credentials, user sessions, project files, local pet imports, build output, or signing
  material in the release tree.
- The third-party notices and 20 bundled backgrounds match the committed lockfile and manifest.

## Local verification

Run source checks in the working tree:

```powershell
npm ci
npm run verify:hygiene
npm run licenses:check
npm run lint
npm run typecheck
npm test
npm run verify:backgrounds
```

Do not run `next build` in an active development worktree. Create an isolated worktree or clean
release checkout, then run:

```powershell
npm ci
npm run dist:win
npm run verify:package
npm run smoke:portable -- --expected-version 0.1.0
```

`verify:package` starts the packaged standalone service in an isolated home directory and checks
HTTP authentication, Pi session startup, external package/extension/tool/Skill discovery,
the exact packaged npm dependency manifest, CycloneDX SBOM, content-hashed third-party license
texts, project license files, and the absence of known development-only packages. Electron
Builder generates this material from the final `resources/web` tree before creating the portable
executable; do not hand-edit `resources/licenses/third-party`. For a normal packaged verification,
the extension fixture runs through the executable in `win-unpacked` with Electron's
`ELECTRON_RUN_AS_NODE` mode rather than the developer's Node.js executable.

`smoke:portable` launches the final portable EXE in an isolated profile and requires its reported
application version to match `--expected-version`. It also requires the hidden smoke window to load
the renderer, expose the preload bridge, and reach the piGUI application shell before passing.
The default five-minute timeout includes first-run extraction and cleanup of the complete portable
payload; a healthy marker alone is insufficient if the wrapper never exits cleanly.

## Publish a prerelease

After the local gates pass, push `main`, wait for the public CI matrix, then create and push the
matching version tag:

```powershell
git tag -a v0.1.0 -m "piGUI v0.1.0"
git push origin v0.1.0
```

The tag workflow first runs the complete source gate on Ubuntu with Node.js 22.19.0. The Windows
build starts only after that gate passes, repeats the source checks on Windows, builds the portable
artifact, verifies the packaged service through the packaged Electron runtime, smoke-tests the final
EXE and its embedded version in an isolated profile, creates
`SHA256SUMS.txt`, and creates a **draft** GitHub prerelease. A maintainer must inspect the draft,
download and verify its assets, complete the checks below, and explicitly publish it. The workflow
never publishes the draft automatically. Never manually mark an unsigned artifact as a signed or
stable release.

The initial preview intentionally has no custom application icon because no reviewed original
icon asset is available yet; Windows may show the generic Electron application icon. Add only an
original, license-reviewed icon before describing the visual identity as final.

## Review the draft before publication

- Download the artifact and checksum from the draft Release page.
- Verify SHA-256 on a separate path.
- Start on a clean Windows 10/11 x64 environment and verify first launch, project selection, chat,
  file editing/conflicts, portable-folder replacement, data retention/removal behavior,
  backgrounds, companion opt-in/import, and an external Pi extension package. If the first
  unsigned preview is published before this matrix is available, keep it marked as a prerelease
  and list every unverified Windows interaction explicitly in the Release notes; never describe it
  as stable or fully clean-machine validated.
- Confirm the tag commit passed the required public CI checks and review the unsigned status,
  generated notes, asset names, checksums, and provenance before publishing the draft.
- If any binary gate fails, keep the draft unpublished and publish source-only release notes only
  after clearly documenting the limitation.

## Post-release record

- Confirm the public Release page exposes the reviewed assets and checksums.
- Update `docs/open-source/PROJECT_STATUS.md`, `docs/open-source/LAUNCH_CHECKLIST.md`, and the
  release goal with the exact commit, CI run, and Release URL.
