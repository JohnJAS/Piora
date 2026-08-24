# Piora release procedure

The Piora release process is configured to publish source code and two unsigned Windows x64 no-install packages from
[`kexijiang/piora`](https://github.com/kexijiang/piora). It does not publish the former
`@agegr/pi-web` npm package.

Each release contains an extract-and-run ZIP whose root includes `Piora.exe`, a
single-file portable executable, and `SHA256SUMS.txt` covering both packages.

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
node scripts/smoke-test-portable.mjs --expected-version 0.1.0
```

`verify:package` starts the packaged standalone service in an isolated home directory and checks
HTTP authentication, Pi session startup, external package/extension/tool/Skill discovery,
the exact packaged npm dependency manifest, CycloneDX SBOM, content-hashed third-party license
texts, project license files, and the absence of known development-only packages. Electron
Builder generates this material from the final `resources/web` tree before creating the portable
executable; do not hand-edit `resources/licenses/third-party`. For a normal packaged verification,
the extension fixture runs through the executable in `win-unpacked` with Electron's
`ELECTRON_RUN_AS_NODE` mode rather than the developer's Node.js executable.

The portable smoke script launches the final portable EXE in an isolated profile and requires its reported
application version to match `--expected-version`. It also requires the hidden smoke window to load
the renderer, expose the preload bridge, and reach the Piora application shell before passing.
The default five-minute timeout includes first-run extraction and cleanup of the complete portable
payload; a healthy marker alone is insufficient if the wrapper never exits cleanly.

## Publish a stable release

After the local gates pass, push `main`, wait for the public CI matrix, then create and push the
matching version tag:

```powershell
git tag -a v0.4.0 -m "Piora v0.4.0"
git push origin v0.4.0
```

The tag workflow first runs the complete source gate on Ubuntu with Node.js 22.19.0. The Windows
build starts only after that gate passes, repeats the source checks on Windows, builds the portable
artifact and extract-and-run ZIP, verifies the packaged service through the packaged Electron runtime,
smoke-tests the final EXE and its embedded version in an isolated profile, verifies the ZIP structure, creates
`SHA256SUMS.txt`, and publishes a public GitHub Release marked as the latest stable version. The
release is created only after every source and Windows packaging gate succeeds. The packages remain
unsigned, and the Release notes must disclose the Windows reputation warning and manual-update model.

The preview uses the original Piora icon recorded in
[`desktop/build/README.md`](../desktop/build/README.md). Electron Builder consumes the reviewed
multi-resolution `icon.ico`; the same mark is exported to the browser/PWA icons. Before publishing,
verify the ICO sizes and transparent edge on light and dark surfaces, then extract and inspect the
icons embedded in both `win-unpacked/Piora.exe` and the final portable EXE. A completed visual
identity does not imply that the executable is signed.

## Stable-release acceptance before tagging

- Start on a clean Windows 10/11 x64 environment and verify first launch, project selection, chat,
  file editing/conflicts, portable-folder replacement, data retention/removal behavior,
  backgrounds, companion opt-in/import, the built-in browser, and an external Pi extension package.
- Confirm project selection through the native folder picker immediately binds the new conversation,
  and verify model selection with both short and long model ids at normal desktop widths.
- Import a real Chrome bookmarks bar and verify direct top-level folders, folder expansion, and the
  absence of profile or bookmarks-bar wrapper folders.
- Do not create the stable tag until the reviewed commit has passed public CI. If a binary gate fails,
  delete or supersede the candidate tag rather than publishing unverified assets manually.

## Post-release record

- Confirm the public Release page exposes the reviewed assets and checksums.
- Download both packages and the checksum, verify both SHA-256 entries on a separate path, and confirm
  that the ZIP opens directly to `Piora.exe` plus its runtime files rather than an extra wrapper folder.
- Update `docs/open-source/PROJECT_STATUS.md`, `docs/open-source/LAUNCH_CHECKLIST.md`, and the
  release goal with the exact commit, CI run, and Release URL.
