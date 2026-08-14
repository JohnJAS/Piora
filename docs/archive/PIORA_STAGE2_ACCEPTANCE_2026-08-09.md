# Piora Stage 2 Acceptance — 2026-08-09

## Scope

- T-14: Right workspace with persisted Review / Files tabs and resizable width.
- T-15: Git change review grouped by staged, unstaged, and untracked state.
- T-16: Guarded stage, unstage, revert, diff-hash, and commit APIs.
- T-17: File and hunk Git actions, commit flow, confirmations, and refresh events.
- T-18: Unified GUI and Pi command palette with fuzzy search and keyboard access.

## Acceptance results

- Files are rendered only in the right workspace; the left task sidebar has no file tree.
- Review renders per-file line counts and text diffs, with keyboard file navigation.
- Git mutations validate allowed roots, relative paths, symlink boundaries, conflicts,
  payload size, output size, timeouts, and stale diff hashes.
- Command palette opens with `Ctrl/Cmd+K`, traps focus, shows disabled reasons, and
  includes runtime Pi slash/skill commands.
- The right tab restores after hydration without changing the server's initial markup.
  This fixed a hydration mismatch found during browser acceptance.
- Browser acceptance found no Next.js error overlay or horizontal viewport overflow.
- Settings entry remains the gear button and session information uses the normal cursor.

## Verification

- `npm test`: 482 tests, 477 passed, 5 skipped, 0 failed.
- `node --test components/workspace/RightPanel.test.mjs`: 2 passed.
- `node_modules/.bin/tsc --noEmit`: passed.
- `npm run lint`: passed with no warnings.
- Real temporary-repository Git test: hunk stage and unstage passed without touching
  the second hunk.
- Browser: Review / Files tabs, file tree migration, Review diff, command search,
  disabled command reasons, Pi command registration, keyboard tab switching, focus,
  and hydration were checked at `http://127.0.0.1:30141`.

No stage, revert, commit, or other Git mutation was executed against the real Piora
working tree during browser acceptance.
