# Piora unified TaskRun runtime

Status: core runtime contract with optional workflow extensions, 2026-08-31

## Boundary

`TaskRunState` is the shared product contract for work that the core application or Rooms actually
owns. It answers the common UI questions: what is running, what needs the user, what failed, and
what can resume.

The core sources are:

- an ordinary RPC prompt running in an `AgentSession`;
- collaboration-room tasks persisted by the room store;
- future Harmony approval references.

Goals and structured plans are not core task modes. `piora-goal.ts` and `piora-plan.ts` are optional
first-party extensions, disabled by default. Their custom session entries are private extension
state and are not projected into sidebar task status or the core prompt protocol.

## Identity

- `taskId` is stable for the product task;
- `sessionId` identifies the Pi session executing it;
- `operationId` identifies one execution attempt when its source provides one;
- `parentTaskId` links room subtasks to a coordinator task.

## Phases

```text
draft -> planned -> waiting_approval -> running -> verifying -> completed
  |          |              |             |  |          |
  |          +--------------+-------------+  |          +-> failed
  |                                           +-> waiting_user
  |                                           +-> blocked
  |                                           +-> interrupted
  +-----------------------------------------------------> cancelled
```

`waiting_user` asks for information. `waiting_approval` asks for authority to perform a known
action. Replay never repeats external side effects; an unfinished runtime becomes `interrupted`
unless the owning subsystem proves it can resume safely.

## Optional Plans extension

The Plans extension stores a versioned `piora-plan-artifact` custom entry and registers two ordinary
tools:

- `piora_plan` saves a structured plan for review;
- `piora_plan_execution` tracks dependency-ordered execution and verification.

The user controls saved plans with `/plan status`, `/plan approve`, `/plan cancel`, and
`/plan execute`. These commands and tools exist only while the extension is enabled. Plan approval
and execution are not RPC commands, do not activate a composer mode, and do not acquire a core
read-only lease.

Completed steps require evidence. Final execution completion requires verification coverage for
every success criterion and a change summary. The extension observes its own tool execution events
to record successful runtime checks and file artifacts. Incomplete execution becomes `interrupted`
when its extension turn settles.

## Optional Goals extension

The Goals extension registers `piora_goal` and `/goal`. `piora_goal` can explicitly create a saved
goal, record progress and evidence, or finish, block, or wait for the user. A later ordinary user
message can rebind the saved goal to that extension turn. The extension never starts automatic
model continuations and the core wrapper has no goal lifecycle state.

## Runtime projection and UI attention

For ordinary core work, phase is selected from the active approval request, current RPC runtime,
and last prompt failure. Room tasks use their room-owned durable state.

UI attention priority remains:

```text
needs_approval > needs_input > failed > unread > none
```

Viewing a task may clear a presentation badge. It must not mutate the owning TaskRun phase.

## Non-goals

- adding Goal or Plan flags to prompt requests;
- automatically continuing a Goal after a model turn;
- automatically executing saved Plan output;
- treating extension tool selection as an operating-system sandbox;
- merging room worktrees automatically.
