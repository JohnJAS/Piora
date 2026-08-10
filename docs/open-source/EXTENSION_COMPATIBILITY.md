# Pi extension compatibility in Piora

Piora does not define a second plugin or agent system. The desktop application starts Pi's coding-agent runtime in-process and uses Pi's own resource loader, settings, package manager, extension API, skills and session format. A feature available through Pi should remain a Pi feature; the GUI only adapts interactions that otherwise belong to the terminal UI.

## Compatibility model

| Pi capability | Development/Web | Packaged Windows app | Notes |
| --- | --- | --- | --- |
| Global extensions in the Pi agent directory | Supported | Implemented; release verification pending | The app uses the real user home and does not bundle user data. |
| Project extensions in the selected workspace | Supported after project trust | Implemented; release verification pending | Opening a project never silently grants extension execution trust. |
| Skills, prompts and themes discovered by Pi | Supported | Implemented; release verification pending | Enable/disable state remains in Pi settings. |
| Extension-defined tools and commands | Supported | Implemented; release verification pending | They remain runtime-defined; Piora does not hard-code them. |
| Select, confirm, text input, editor, notify and status UI | Adapted by the GUI | Adapted by the GUI | Terminal-oriented rendering may differ visually. |
| Package install/update requiring `npm`, `npx` or `git` | Uses tools on `PATH` | Uses tools on `PATH` | A portable EXE does not currently ship a private package manager or Git. |
| Native Node add-ons (`.node`) | Environment-dependent | Limited | Add-ons must match the Electron/Node ABI and platform architecture. |
| Arbitrary terminal escape sequences/full-screen TUI | Not a compatibility target | Not a compatibility target | Extensions should use Pi's extension UI contract rather than assuming ownership of a terminal. |

## What is preserved

- Pi remains responsible for extension discovery, loading, lifecycle, tools, commands and configuration.
- The default Pi agent directory remains `~/.pi/agent` unless the user explicitly configures `PI_CODING_AGENT_DIR`.
- The desktop packaging configuration includes the Pi runtime distribution required to discover and execute extensions; each release must prove this in the isolated fixture before making a packaged-support claim.
- Project trust applies before project-provided code is loaded.
- Generic extension UI events are translated into GUI controls without introducing Piora-specific SubAgent semantics.

## What is not bundled

The portable Windows application does not embed a separate npm registry client, `npx`, Git distribution, compiler toolchain, shell profile, API keys, existing extensions, skills, projects or sessions. Already installed JavaScript/TypeScript extensions can load from the user's Pi directories, but an install or update action that shells out to missing system tooling will fail with an actionable error.

Native add-ons are a stricter boundary. A module compiled for a standalone Node.js ABI may not load inside Electron. Until a separately versioned Node sidecar is implemented and verified, native extension packages are documented as limited rather than silently advertised as fully compatible.

## Release verification

As of 2026-07-31, the packaged synthetic-fixture result has not yet been recorded. The table above
describes the implemented compatibility path, not a certification of an existing public binary.

Every Windows release must exercise a synthetic extension fixture that:

1. is placed in an isolated temporary Pi agent directory;
2. registers a uniquely named tool and a simple command;
3. is discovered after a trusted test project starts;
4. receives the headless/custom UI facade without crashing;
5. runs through the packaged standalone service without resolving modules from the developer checkout;
6. leaves the user's real Pi directory untouched.

The release checklist must record the fixture result. Passing the fixture establishes the supported JavaScript/TypeScript baseline; it is not a blanket claim that every third-party extension or native dependency will work.

## Guidance for extension authors

- Use Pi's documented extension APIs and resource locations.
- Avoid depending on exact terminal dimensions, raw cursor movement or a full-screen terminal.
- Treat GUI notifications and widgets as advisory presentation surfaces, not security boundaries.
- Declare external executables and native dependencies clearly.
- Keep network access explicit and user-visible.
- Test against the exact Pi package version listed in Piora's lockfile.
