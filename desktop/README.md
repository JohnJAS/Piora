# Piora desktop shell

This directory owns the Electron process only. The existing Piora web application
continues to run as an independent Next.js standalone process on loopback.

## Development

Install this directory's pinned toolchain, then compile it:

```powershell
cd <repository>\desktop
npm install
npm run typecheck
npm run build
```

The shell expects a Next standalone `server.js`. During local shell work, point
at an existing standalone artifact explicitly:

```powershell
$repositoryRoot = git rev-parse --show-toplevel
$env:PI_DESKTOP_SERVER_ENTRY = Join-Path $repositoryRoot ".next\standalone\server.js"
npm start
```

Do not run `next build` as part of the normal Piora development loop. Produce
the standalone output in an isolated release checkout or CI job.

## Release input

The repository's release configuration must enable Next's `output:
"standalone"`. Before packaging, the staged standalone tree must exist:

- `../.next/standalone/server.js`

Run `npm run build:web` from the repository root to create it and stage
`public/` plus `.next/static/`. `electron-builder.yml` copies the complete tree
to unpacked `resources/web/`. The standalone tree remains outside the Electron ASAR so traced packages, Pi
extensions, and runtime assets can be resolved normally.

After `npm run pack:win`, run `npm run verify:package` from the repository root.
The verifier copies `resources/web/` outside the checkout, confirms the traced
Next/Pi dependencies are present, starts the service in isolation, and checks
both desktop-token rejection and authenticated health/root responses.

Electron Builder runs `scripts/electron-after-pack-licenses.cjs` after the final
`resources/web` tree is copied and before the portable executable is assembled. It writes an
exact package-copy manifest, CycloneDX SBOM, and content-addressed license texts under
`resources/licenses/third-party/`. The package verifier recomputes and compares this bundle;
do not hand-edit it or replace it with the broader source lockfile inventory.

## Security boundary

- The renderer uses Chromium sandboxing and context isolation with Node.js
  integration disabled.
- Pi and Next execute in a child process with no shell invocation.
- The service binds only to `127.0.0.1` on an available port. The selected port
  is reused when possible so origin-scoped web preferences survive restarts.
- A fresh high-entropy token is passed to the server, enforced by Piora, and
  injected into requests by Electron's network layer. The renderer cannot read
  the token.
- Cross-origin navigation, new Electron windows, webviews, and permission
  requests are denied in the privileged application renderer. The right-side
  Browser tool uses a separate sandboxed `WebContentsView` and persistent
  partition; untrusted pages never receive the application preload bridge.
- Child stdout/stderr and lifecycle events are written to
  `<userData>/logs/piora.log` with one rotated backup.

## Integrated title bar

The desktop window uses Electron's native Window Controls Overlay rather than
`frame: false`. On Windows, the permanent operating-system title/menu rows are
hidden while native minimize, maximize, close, edge resizing, Alt menu access,
and application-menu accelerators remain available.

The web shell owns a 40 px top drag strip. It should use `app-region: drag`
(plus the prefixed form supported by Chromium), size its safe area with
`env(titlebar-area-x)`, `env(titlebar-area-width)`, and
`env(titlebar-area-height)`, and mark every interactive child as
`app-region: no-drag`. These environment variables fall back normally in the
browser build, so the same shell can serve both web and desktop.
