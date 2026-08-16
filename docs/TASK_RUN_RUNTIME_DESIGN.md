# Piora unified TaskRun runtime

Status: initial P0 contract, 2026-08-16

Implementation progress:

- [x] pure TaskRun schema, reducer, and replay validation;
- [x] Goal and ordinary RPC runtime projections;
- [x] Room Task projection in room snapshots, mutation responses, and SSE events;
- [x] shared `needs_input` attention mapping;
- [x] durable structured Plan artifact and approve/edit/execute flow;
- [x] runtime-owned verification, file, Git snapshot, and commit provenance;
- [ ] Harmony approval references and restart recovery tracing.

## Problem

Piora currently has several useful but separate task-like state machines:

- an RPC prompt run owns the live Pi `AgentSession` operation;
- Target Mode persists a goal, checkpoints, and evidence in the Pi session file;
- collaboration rooms persist leased tasks and artifacts in the room store;
- Harmony owns approval and device-lease state;
- the sidebar derives runtime and attention from a lightweight process snapshot.

Each subsystem is valid in isolation. The missing boundary is a shared projection that answers the
same product questions for every task: what is the objective, what phase is it in, what needs the
user, what evidence exists, and whether the work can resume.

## Decision

Introduce `TaskRunState` as the common product contract and `TaskRunEvent` as the future durable
event protocol.

The first implementation is deliberately a compatibility projection:

1. existing Goal entries remain the persistence source for Target Mode;
2. existing RPC wrapper state remains the source for an ordinary live prompt;
3. `TaskRunState` is added to runtime snapshots without changing Pi's v3 JSONL format;
4. Room and Harmony adapters can be added after the projection is proven;
5. durable TaskRun events are not written until ownership and replay rules are specified per source.

This avoids two competing writers for Goal state and keeps old session files readable.

## Identity

- `taskId` is stable for the product task. The compatibility adapter uses `goalId` for Target Mode
  and `sessionId` for an ordinary prompt.
- `sessionId` identifies the Pi session currently executing the task.
- `operationId` identifies one execution attempt when a source exposes that identity.
- `parentTaskId` links future room subtasks to their coordinator task.

Changing a session binding must not silently change `taskId` for a room task or durable goal.

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

The common phases are:

- `draft`: objective exists but no accepted plan or run;
- `planned`: a structured plan exists and has not started;
- `waiting_approval`: a concrete action or plan needs a user decision;
- `running`: Pi is actively reasoning, using tools, retrying, or compacting for the task;
- `waiting_user`: progress requires information or a choice from the user;
- `blocked`: an external condition prevents progress;
- `verifying`: implementation is finished and evidence is being collected;
- `completed`: success criteria were satisfied;
- `failed`: the attempt ended in an error and may be retried;
- `interrupted`: runtime ended without a terminal task result and may be resumed;
- `cancelled`: the user intentionally ended the task.

`waiting_user` and `waiting_approval` are distinct. The former asks for information; the latter asks
for authority to perform a known action.

## Plan artifact

A plan is a versioned data artifact, not prose inferred from the latest assistant message.

```ts
interface TaskPlanArtifact {
  schemaVersion: 1;
  id: string;
  objective: string;
  assumptions: string[];
  successCriteria: string[];
  steps: Array<{
    id: string;
    title: string;
    description?: string;
    dependsOn: string[];
    status: "pending" | "running" | "completed" | "blocked" | "skipped";
  }>;
  createdAt: number;
  updatedAt: number;
}
```

Plan Mode remains read-only for the workspace and external state. Its sole metadata mutation is a
`piora-plan-artifact` custom session entry submitted through `piora_plan`. Draft edits and approval
are separate RPC actions guarded by an expected revision. Approval projects the accepted artifact
into a `planned` TaskRun; it does not start execution or modify project files.

Execution requires a second explicit user action. That action starts Target Mode with the approved
plan identity and an expected revision. The plan-owned TaskRun then moves through `running`,
`verifying`, and a terminal phase while Goal Mode supplies the continuation loop. The
`piora_plan_execution` tool records dependency-checked step transitions. A restored execution that
was previously `running` or `verifying` becomes `interrupted` until the user resumes it.

Execution completion is evidence-gated. Every completed step has at least one associated evidence
record; files, patches, commits, and reports can be attached as bounded artifact references.
Verification evidence names the zero-based success criteria it proves. Final completion requires
coverage of every criterion and a persisted change summary. These records project into TaskRun's
shared `evidence` and `artifacts` arrays.

Evidence provenance is explicit. Records submitted by `piora_plan_execution` are marked `model`;
the tool schema cannot request a different source. The session wrapper observes actual tool start
and end events and marks successful verification commands and file mutations as `runtime`. Entering
verification also captures a read-only Git status snapshot, and a successful Git commit command can
produce a bounded commit reference. Raw command arguments and output are not copied into evidence.

Final completion requires at least one successful runtime verification from a conservative allow
list (tests, typecheck, lint, or `git diff --check`). Shell constructs that could mask a failure,
such as `||`, pipes, semicolons, or multi-line scripts, are not trusted as verification. They remain
ordinary observations. Criterion mapping remains an explicit model responsibility, so completion
requires both runtime proof and criterion coverage rather than treating either one as sufficient.

## Event and replay rules

`TaskRunEvent` is append-only. A reducer validates task identity and legal phase transitions. Events
may add progress, evidence, and artifact references without rewriting previous records.

Before events become durable, each adapter must define a single writer:

- Goal: Pi session custom entries, written through the Goal extension/runtime;
- Room task: room store task/event files, written through room-store locking;
- ordinary prompt: a future task sidecar or Pi-supported durable operation record;
- Harmony approval: Harmony remains the approval authority; TaskRun stores only a bounded reference.

Replay must never repeat external side effects. Recovery changes an unfinished `running` phase to
`interrupted` unless the underlying runtime provides a proven resumable operation boundary.

## Runtime projection priority

For the initial compatibility adapter, phase is selected in this order:

1. terminal or waiting Goal state;
2. active approval request;
3. current RPC runtime;
4. last prompt failure;
5. interrupted active Goal after runtime loss.

The UI attention priority is:

```text
needs_approval > needs_input > failed > unread > none
```

Viewing a task may clear the presentation-level attention badge. It must not mutate TaskRun phase.

## Incremental rollout

1. Add the pure schema, reducer, Goal adapter, and RPC snapshot adapter.
2. Drive the existing `needs_input` presentation from `waiting_user`.
3. Add a Room Task adapter and parent/child task links.
4. Persist structured plan artifacts and add explicit edit/approve/cancel UI states. (Implemented)
5. Add the separate approved-plan-to-execution transition and dependency-checked step tracking. (Implemented)
6. Consider Pi's durable AgentHarness only behind an adapter after its upstream lifecycle and
   recovery contracts are migration-ready.

## Non-goals for this slice

- changing existing Pi session JSONL entries;
- automatically executing Plan Mode output;
- treating tool presets or approval prompts as an operating-system sandbox;
- merging room worktrees automatically;
- migrating the production runtime to experimental AgentHarness APIs.
