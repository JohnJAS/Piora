# Changelog

All notable changes to Piora are documented here. The project follows [Semantic Versioning](https://semver.org/) after the first tagged public release.

## [Unreleased]

## [0.4.0] - 2026-08-24

### Changed

- Flatten Chrome bookmark imports so the contents of each Chrome bookmarks bar
  appear directly in Piora, without profile or bookmarks-bar wrapper folders.
- Make the global system prompt editable from the conversation controls and
  settings, then reload every idle Session immediately and every busy Session
  as soon as its active task finishes.
- Promote the verified `v*` release pipeline from preview publishing to stable
  GitHub Releases, with the newest successful release marked as latest.

### Fixed

- Keep the model submenu attached to its parent menu, align every provider icon
  with its model name, and truncate long model ids without compressing labels.
- Open a project-bound new conversation immediately after the native folder
  picker validates a newly selected project directory.

## [0.3.9] - 2026-08-24

### Added

- Added Chrome bookmark import to the built-in browser, preserving the complete
  bookmark folder hierarchy in its bookmark bar and folder browser.

### Changed

- Reworked the new-conversation guidance around configuring a model first and
  then opening a project folder, and removed the unsupported local/cloud label.
- Simplified the Projects sidebar by removing its redundant task search field
  and keeping unselected project rows visually transparent.

### Fixed

- Kept the composer model selector inside the visible viewport and removed the
  misleading help cursor from MCP tool status.
- Restored the intended onboarding and browser bookmark experience after
  concurrent interface work had overwritten parts of those changes.

## [0.3.8] - 2026-08-24

### Fixed

- Fixed packaged Plan Mode and Agent Team runs failing because first-party
  extensions could not resolve newly added runtime support modules from
  `runtime.asar`.
- Strengthened packaged-app verification to fail the release when any
  first-party extension reports a load diagnostic or any core Piora tool is
  missing or inactive.

## [0.3.7] - 2026-08-24

### Fixed

- Prevented the built-in browser's download-directory setup from aborting
  desktop startup when Windows does not expose a shell Downloads folder; Piora
  now falls back to an app-owned Downloads directory.

## [0.3.6] - 2026-08-23

### Added

- Added a production Agent Team runtime with durable plans, dependency-aware
  scheduling, bounded retries, evidence and artifact tracking, independent
  review, recovery after interruption, and authenticated Room APIs and events.
- Added first-class Team progress, questions, approvals, and final results to
  Room chat, plus a floating activity card, a complete message navigator, and
  one-click navigation to the latest message.
- Added AI-assisted editing for team descriptions, Agent responsibilities,
  prompts, constraints, and collaboration conventions, with a separately
  configurable optimization model.

### Changed

- Publish verified release artifacts as public GitHub prereleases immediately
  instead of leaving each version in a maintainer-only draft state.
- Simplified Team setup and goal submission, defaulted the interface and
  optimization instructions to Simplified Chinese, and aligned icons, buttons,
  hover feedback, activity controls, and status surfaces with the Codex visual
  language.
- Reused the normal Target execution path for approved Team plans, while
  automatically starting user-authored plans without an extra approval step.

### Fixed

- Fixed silent Room submissions, missing user-question prompts, non-responsive
  resume controls, capability mismatch dead ends, stale hot-reload coordinator
  instances, and legacy English error messages.
- Fixed long-conversation navigation, misleading status icons, inaccessible
  progress placement, and forms that previously required unexplained manual
  detail before a Team could start.

## [0.3.5] - 2026-08-22

### Fixed

- Regenerated the deterministic third-party license inventory after the
  application version update so the release source gate can complete.

## [0.3.4] - 2026-08-22

### Added

- Added a dedicated model preference for automatic Session title generation,
  including safe cancellation while a title request is in progress.
- Added a native Windows folder chooser for selecting a new-conversation
  project in the packaged desktop application.

### Changed

- Redesigned the new-conversation landing screen, composer model and reasoning
  controls, extension status indicator, and common action buttons around a
  quieter Codex-inspired visual language.
- Moved MCP and extension runtime status into a compact composer control instead
  of reserving a full-width bar below the input.

### Fixed

- Kept the model menu anchored above the composer on both desktop and narrow
  layouts, with no unsupported speed setting.
- Prevented background Session refreshes from leaving the Projects area in a
  permanent loading state when Rooms and Projects are both present.

## [0.3.3] - 2026-08-22

### Added

- Added runtime MCP Server and cached tool-capability discovery to the
  `pi-mcp-adapter` plugin details view without exposing credentials or tool
  input schemas.
- Added real idle-frame thumbnails for installed and locally discovered
  companion pets.
- Added an introductory comparison of Pi extensions, skills, and plugins to
  each capability settings page.

### Changed

- Redesigned plugin package details and resource cards to separate packaged
  resources from runtime MCP capabilities.
- Extended the validated companion-pet spritesheet route so local Codex pets
  can be previewed safely before import.

### Fixed

- Removed the modal-backdrop styling that incorrectly rendered plugin resource
  groups as large gray blocks.

## [0.3.2] - 2026-08-22

### Added

- Added remote HTTP APIs for creating Sessions, discovering core capabilities,
  reading Session history, and listing the tools available to a Session.
- Added archived-conversation management directly in Settings.
- Added configurable automatic Session naming with a dedicated title prompt.

### Changed

- Redesigned the Windows application menu and Settings workspace around a
  compact four-menu desktop layout and grouped, capability-aware navigation.
- Made the bundled Browser and Harmony integrations discoverable in packaged
  builds without making their successful startup a hard Session requirement.
- Expanded remote-control capability metadata and packaged-runtime verification
  for third-party HTTP extensions.

### Fixed

- Improved task-list density, status rendering, and Session title consistency.
- Kept packaged runtime extension and server startup behavior aligned with the
  development environment.

## [0.3.1] - 2026-08-21

### Added

- Added an explicit project picker for new conversations, including project
  search and a system-folder chooser instead of silently inheriting the active
  Session's project.
- Added Room mention completion for manually typed `@`, keyboard selection,
  immediate Agent processing presence, and automatic reply projection back
  into the shared conversation.
- Added persistent pin indicators to pinned Sessions.
- Windows portable and ZIP-extracted releases now create a `Piora` Desktop
  shortcut on launch. Later versions advance the shortcut target, older
  versions cannot downgrade it, and missing targets are repaired to the newest
  available version that the user launches.

### Changed

- Room creation now supports cross-project Session selection with grouped
  project labels and a fixed action footer that remains reachable for long
  Session lists.
- Room shared workspace paths can be edited or selected from the desktop folder
  chooser and may live within any member Session's project.
- Browser and Harmony extensions now advertise their exact built-in tool names
  and invocation shapes to every compatible Agent prompt.
- Redesigned the new-conversation landing screen around the composer, with an
  anchored searchable project menu and draft handoff after project selection.

### Fixed

- Conversation chrome and Room workspaces now preserve the configured artwork
  instead of covering it with opaque white surfaces.
- Removed the inactive sidebar-header search button while retaining functional
  Session search.
- Room replies now remain correlated with the addressed message and are shown
  in the Room even when an Agent omits the explicit shared-reply tool call.
- Restored the right workspace toggle while a new conversation is waiting for
  its explicit project selection.
- Added a confirmed delete action for collaboration rooms and synchronized the
  active workspace, URL, and sidebar immediately after deletion.

## [0.3.0] - 2026-08-20

### Added

- Added reliable target-Session message routing with per-Session FIFO queues,
  cross-Session parallelism, idempotency, tracked command/run lifecycle events,
  restart recovery, and bounded JSONL journals.
- Added scoped remote control over HTTP/SSE with Bearer capability tokens,
  revocation, rate limiting, command status, state, steer, abort, and event
  subscription endpoints.
- Added a process-level outbound WebSocket connector and remote-control settings
  UI with English and Simplified Chinese translations.
- Added Room fan-out correlation, bounded parallel dispatch, and routing loop
  protection.

### Changed

- Isolated AgentSession extension runtimes and service caches per Session, with
  deterministic runtime resolution for cold Session restoration.
- Routed UI, Room chat, and Coordinator prompt delivery through the unified
  SessionMessageRouter.

## [0.2.9] - 2026-08-20

### Added

- Added a DevEco-style Harmony log workspace with process selection, log-level
  and text filters, bounded live polling, and the same read-only process/log
  actions exposed to the agent.
- Added proactive discovery hints so browser and Harmony troubleshooting
  requests reliably select their bundled extension tools.

### Changed

- Restyled Goal and Plan panels, running-message steer/queue controls, queued
  messages, slash-command results, notices, extension prompts, and workspace
  alerts to use the compact neutral Codex visual language.
- Reduced the conversation toolbar to Git changes, history, and the right-panel
  toggle, with live tracked-change totals.
- Improved Harmony frame polling responsiveness while avoiding screenshot/log
  contention, and preferred the user-visible device name over the product model.

### Fixed

- Strengthened Target Mode instructions so active goals must record progress,
  evidence, or an explicit terminal/waiting state before a turn can settle.
- Removed the slash-command palette's accent selection rail and aligned command
  completion feedback with the rest of the application UI.

## [0.2.8] - 2026-08-18

### Added

- Harmony device operations execute directly: acquiring AI control no longer
  shows a per-run confirmation dialog, while the bounded lease keeps the same
  automatic release guarantees.
- Collaboration rooms can add sessions from any project; the agent picker
  labels every session with its project path.
- Builtin slash-command results (compact, reload, name, copy, session) echo
  into the conversation area as readable rows instead of transient notices.

### Changed

- The slash command palette uses a Codex-style single-column list with
  grouped rows, source badges, and keyboard hints.
- The streaming-action menu (steer vs. queue) supports arrow-key navigation
  and Enter/Escape, and both the menu and queued-message rows follow the
  Codex visual style.

### Fixed

- Confirmation dialogs opened from the settings models page now appear above
  the settings dialog instead of behind it.

## [0.2.7] - 2026-08-18

### Added

- The project area and the right file panel now share the selected background
  artwork, each with an independent opacity control in appearance settings.
- Render isolation boundaries keep one malformed chat message or workspace
  panel from taking down the whole application; the Harmony device panel
  recovers automatically as soon as a fresh poll delivers valid data.

### Fixed

- Fragmented streaming tool calls (common with DeepSeek responses) and
  malformed sessions restored across versions can no longer crash the chat
  renderer with "Cannot read properties of undefined" errors.
- The Harmony device panel validates every poll and event payload before
  rendering, so an open panel can no longer trigger the global reload screen.
- Session creation and selection no longer navigate through the Next.js
  router in production, avoiding Suspense remount loops and renderer crashes.
- Mounting a running session no longer tries to mutate its active tool set.
- Client assets are versioned per release and the packaged runtime is
  validated, preventing stale assets from mixing across upgrades.
- The bundled dependency patch no longer fails with EEXIST on newer Node.js.

## [0.2.6] - 2026-08-16

### Fixed

- Removed obsolete PWA service workers and Cache Storage from the persistent
  Electron partition before loading the desktop UI, preventing older Next.js
  assets from resurfacing after an upgrade when opening workspace tools such as
  the Harmony device panel.
- Added recoverable application error screens and desktop renderer diagnostics
  so an unexpected client failure can be reloaded and traced from the Piora log.

## [0.2.5] - 2026-08-16

### Added

- Added structured Plan Mode artifacts with editable drafts, explicit approval,
  dependency-ordered execution, step evidence, verification coverage, and
  recoverable interrupted-run state.
- Added a unified extension inventory and per-extension controls backed by the
  same resolved load plan used when agent sessions start.
- Added a second unsigned Windows release format: an extract-and-run ZIP beside
  the existing single-file portable executable.

### Changed

- Expanded task and room runtime state so planned and executing TaskRuns remain
  visible and consistent across polling, SSE updates, and restored sessions.

## [0.2.4] - 2026-08-15

### Changed

- Polished the unified Harmony device workspace with a clearer settings switch,
  less crowded quick controls, and reference screenshots for visual review.

## [0.2.3] - 2026-08-15

### Added

- Added a Codex-style composer add menu with mutually exclusive, one-shot target
  and plan modes. Plan mode temporarily limits the agent to read-only inspection
  tools and restores the session configuration after the response.
- Added multi-session collaboration rooms with shared tasks, artifacts, messages,
  and optional coordinator-driven dispatch.
- Added bounded Harmony automation waits for fixed delays, richer UI-node state
  conditions, and locally sampled PNG screen stability with optional regions.
- Harmony wait results now report elapsed time and polling evidence, while timeouts
  include bounded diagnostics without forwarding additional frames to a model.
- Redesigned the Harmony workspace around a full, proportionally fitted phone
  screen, compact primary controls, progressive settings, and shorter copy.

### Changed

- Refined the Harmony device workspace into a compact Codex-style control surface
  with progressive settings and a larger live device frame.

## [0.2.2] - 2026-08-15

### Changed

- Unified the main Piora desktop release and HarmonyOS NEXT automation preview
  into one `0.2.2` version and one standard Windows release artifact.
- Existing ordinary sessions now load `harmony_device` directly without a
  device-control profile switch or standalone-service restart.
- Made device projection polling abortable, non-overlapping, visibility-aware,
  generation-bound, and failure-backoff aware to reduce HDC load and stale input.
- Added capability-aware device controls, recoverable manual ownership, and
  immediate lease cleanup when a device becomes unavailable.

### Security

- Removing the dedicated device-control runtime also removes its tool/resource
  isolation; per-run confirmation, leases, stale-state checks, sensitive-action
  limits, and emergency stop remain as misuse guards rather than a sandbox.

- UI-reference taps now re-read and uniquely match a fresh device tree before
  execution; every write invalidates cached references.
- HDC selections must pass a real read-only probe before replacing the working
  configuration, and vision screenshots/output have explicit size and format bounds.
- Phone UI and perception output are delimited as untrusted data, while AI
  coordinate actions require the current device generation.

## [0.2.1] - 2026-08-14

### Added

- Added automatic Harmony SDK/HDC candidate discovery, a visible installation
  chooser, and native Windows pickers for either an SDK folder or `hdc.exe`.
- Added split-model phone perception: a configured image-capable model receives
  screenshots and returns structured observations while the action model receives
  the UI tree and observation text. Raw screenshot forwarding stays off by default.
- Added persistent target mode to the composer. Target-mode prompts continue across
  model turns until the agent verifies completion, reports a concrete blocker, the
  user stops the run, or the continuation safety limit is reached.

### Security

- Phone screenshots sent for perception use an explicit model selection, no prompt
  cache retention, and contain no conversation history, device input text, lease
  tokens, or credentials.
- The device-control profile admits only the first-party Harmony and target-mode
  tools; target completion is bound to the active server-generated prompt run.

## [0.2.0] - 2026-08-13

### Added

- Added a desktop-only HarmonyOS NEXT device workspace with USB/HDC runtime
  discovery, connection diagnostics, a visible local device projection,
  UI snapshots, structured manual actions, and an emergency stop.
- Added a restricted AI device-control runtime with explicit per-run consent,
  device leases, serialized actions, stale-snapshot protection, and no raw HDC
  shell surface.
- Added a dedicated GitHub Harmony preview pipeline that verifies and publishes
  an independently versioned Windows portable prerelease.

### Security

- Harmony device APIs fail closed outside the packaged desktop runtime and the
  restricted device-control profile.
- Screen data sharing, write actions, process timeouts, output bounds, and
  device identifiers use explicit local policy and data-minimization rules.

## [0.1.7] - 2026-08-14

### Added

- The desktop companion can optionally stop floating above every window while
  preserving the always-on-top behavior as the default.
- Appearance settings include a restrained Codex-inspired dark preset without
  requiring a background image.
- Mandarin dictation normalizes Traditional Chinese output to Simplified
  Chinese and supplies Whisper with a Simplified Chinese transcription hint.

### Changed

- Secondary settings and management dialogs load on demand so the first usable
  desktop frame parses less client code.
- The desktop uses Pi's standard data directory unless an explicit
  `PI_CODING_AGENT_DIR` is configured, removing the first-launch migration
  prompt and its duplicate data-copy path.
- The Dream skin uses quieter surfaces, borders, shadows, and focus treatments,
  and the startup shell uses a short reduced-motion-aware progress pulse.
- Pi SDK packages moved to 0.84.1, with compatible Next.js, React, Tailwind,
  Electron, icon, and document-reader maintenance updates.

### Fixed

- Windows worktree removal now compares normalized paths, allowing dirty
  worktrees to return the intended HTTP 409 response and explicit force retry.
- The headless extension UI adapter now supplies the complete background-color
  contract required by Pi SDK 0.84.1.

### Security

- Updated vulnerable `nanoid`, `undici`, and `brace-expansion` dependency paths;
  production `npm audit` now reports zero known vulnerabilities.
- CI now gates high-severity production dependency findings and enforces the
  existing performance budgets.

## [0.1.6] - 2026-08-12

### Added

- Local headset dictation now records from the composer and transcribes fully
  offline with a checksum-pinned Whisper Base Q5 model and whisper.cpp runtime
  bundled inside the Windows executable.
- First desktop launch can select a persistent Pi data directory and safely
  migrate existing sessions, credentials, model settings, and skills while
  retaining the old directory as a verified rollback copy.
- Review now provides a Codex-style commit-or-push menu with optional staging
  of working-tree changes, amend, commit, commit-and-push, and upstream push.
- Added a HarmonyOS NEXT device-automation architecture design for future
  cross-device control work.

### Changed

- Review file rows use compact colored status markers, path-based expansion,
  and lightweight open-file actions instead of leading disclosure arrows and
  textual status pills.
- The desktop companion interaction and animation behavior is more resilient
  across compact and expanded window states.

### Fixed

- Review can load omitted unchanged source lines on demand, including context
  after the final diff hunk.
- Conversation Git line totals exclude untracked file contents while keeping
  untracked files visible in the changed-file count and Review.

## [0.1.5] - 2026-08-12

### Changed

- The Windows portable executable now removes duplicate runtime trees and
  unused Chromium locale packs, uses a smaller compressed first-run payload,
  prepares an artifact-isolated runtime cache once, and enforces that cached
  launches replace the bootstrap splash with the Electron-owned shell within
  three seconds.
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
