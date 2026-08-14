# Privacy and network behavior

Piora is a local desktop interface for Pi. It has no Piora account service, advertising SDK,
analytics SDK, crash-upload SDK, or built-in telemetry pipeline.

## Local data

Unless the user overrides Pi's configuration, Pi-owned state remains under the normal Pi agent
directory in the user's home folder (`~/.pi/agent`, normally `%USERPROFILE%\.pi\agent` on
Windows). This can include sessions, settings, authentication material, installed packages,
extensions, prompts, themes, and skills. The desktop package does not copy that state into the
repository or portable EXE.

The browser/Electron profile stores presentation preferences locally. They include the color
theme, background selection and readability controls, and—when explicitly selected—a custom
background image in IndexedDB or a size-limited localStorage fallback. The companion stores its
open state, selected pet, TODO items, and user-defined quick phrases in localStorage under the
same profile. None of this profile data is uploaded by the theme, background, or companion UI.

On packaged Windows builds the Electron profile is normally under `%APPDATA%\Piora`; development
in a normal browser uses that browser's site-data location instead. Operational logs are written
under the Electron profile's `logs` directory and can include filesystem paths.

## Companion and Codex compatibility

The companion is closed by default for a fresh profile. Its API scans local pet locations only
while the companion panel is open (including when the user previously chose to keep it open) or
the user explicitly refreshes the panel. With the default Codex home, the read-only source paths
are:

- `%USERPROFILE%\.codex\pets`;
- `%USERPROFILE%\.codex\avatars` (legacy packages);
- `%USERPROFILE%\.codex\cache\tui-pets\v1\assets` (built-in cache).

If `CODEX_HOME` is explicitly configured, the same relative paths below that directory are used.
Import is an explicit button action. A validated, normalized manifest and its PNG/WebP sprite
sheet are copied into Piora-owned storage at
`%USERPROFILE%\.pi\agent\piora\pets\<pet-id>`. The importer does not execute JavaScript,
HTML, CSS, npm scripts, CDP hooks, or remote asset URLs, and it does not modify the source Codex
package.

This is an independently maintained, best-effort file-format compatibility layer. It is not an
official OpenAI or Codex integration, and Piora does not bundle Codex pet artwork or branding.

## Local server boundary

The Electron application starts a bundled Next.js service on a dynamically selected
`127.0.0.1` port. A fresh random desktop token is injected by Electron's network layer for that
process. The service is not intended to accept public network traffic in desktop mode.

The web development server can be deliberately started in LAN mode. LAN exposure, password
configuration, and host firewall policy are the operator's responsibility and are not enabled by
the packaged desktop application.

## When network access occurs

The companion, TODO list, local pet scan/import, themes, and background picker do not initiate
remote requests. A quick phrase can reach a model provider only after the user explicitly clicks
its send action; it then follows the same normal Pi prompt path as text typed into the composer.

Other network access is likewise driven by an explicit user action or the selected Pi provider,
for example:

- sending a prompt to a configured model provider;
- provider OAuth/device-code login or API-key validation;
- fetching a configured provider's model catalog;
- testing a model connection;
- analyzing a Harmony phone screenshot after the user enables a specific vision model and the Agent requests a screenshot snapshot; this request contains the screenshot but no conversation history, input text, device lease token, or credential, and raw screenshot forwarding to the action model is off by default;
- searching, installing, or updating Pi packages and skills;
- an installed Pi extension or tool performing its documented network action;
- the operating system or GitHub Actions downloading npm dependencies during a source build.

The exact destination and data sent by a model provider, package registry, extension, or external
tool are governed by that service and configuration. Review them before supplying private source
code or credentials.

## Removal and cleanup

The first public build is a portable EXE, not an installer. Deleting or replacing that EXE does
**not** delete the Electron profile, Pi sessions/settings/credentials, imported pets, or browser
site data. This is intentional so replacing a portable binary does not destroy user state.

To remove only Piora-owned data on Windows, close Piora first, then remove the following locations
if they exist:

- `%APPDATA%\Piora` for the Electron profile, localStorage/IndexedDB preferences, and logs;
- `%USERPROFILE%\.pi\agent\piora` for pet copies imported by Piora;
- the Piora origin's site data in the browser used for web development.

Do not delete all of `%USERPROFILE%\.pi\agent` unless you also intend to remove Pi sessions,
credentials, settings, and installed resources used by Pi itself. Source pet data under
`%USERPROFILE%\.codex` remains owned by Codex and is never removed by Piora.

## What Piora does not do by default

- no analytics, crash-report upload, or behavioral tracking;
- no automatic upload of conversations, projects, TODOs, quick phrases, pets, or backgrounds;
- no phone screenshot upload merely from opening the local Harmony live-view panel;
- no remote theme CSS, theme JavaScript, or background URL loading;
- no separate Project Trust or per-tool approval layer; project resources follow Pi's direct local-agent loading model;
- the built-in browser accesses websites only when an Agent invokes its browser tool, in a private headless context that does not inherit normal browser logins;
- no automatic updater in the initial release;
- no background network monitor owned by Piora.

Review and redact logs before sharing them in an issue. Never attach credentials, private
prompts, session files, TODOs, quick phrases, imported personal artwork, or proprietary source
code to a public report.
