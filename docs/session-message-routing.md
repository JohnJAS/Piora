# Session Message Routing and Remote Control

Piora routes every externally initiated prompt through one session-scoped command
inbox. The inbox is the concurrency boundary for a Pi session: commands for the
same session are FIFO, while different sessions may run concurrently.

## Local routing model

`lib/session-message-router.ts` is the single dispatch path used by the normal
agent API, Room chat/coordinator work, remote HTTP, and the optional WebSocket
connector. Callers provide a target session id, message content, source, and an
idempotency key. The router validates the target, message size, expiry, and
principal permissions before accepting the command.

`next_turn` is the default delivery mode. It waits for the target session to be
idle, then starts one tracked prompt. `steer` is intentionally separate: it is
accepted only when the target is already running and is delivered to that active
run. A steer never silently becomes a queued next-turn prompt.

Each command has a durable command id and status journal. The journal records
the full command needed for recovery, but secrets are never written there. Event
journals use a per-session monotonic cursor and are suitable for replay after an
SSE reconnect. Terminal command records can be compacted after the configured
retention window; non-terminal records remain recoverable.

The router restores accepted/queued/dispatching commands after process restart.
A persisted running command is marked `interrupted` unless a live wrapper owns
the same run id. Recovery is explicit and idempotent, so a reconnect or duplicate
request does not execute a command twice.

## Rooms

Room chat and coordinator dispatch use the same router with `source: "room"` and
stable keys derived from room, message/task, target session, and attempt. Room
coordination keeps its existing leases, dependency checks, worktree protections,
and `maxConcurrency`; the router adds per-session FIFO ordering underneath.
Room batches dispatch to distinct members concurrently, but two commands aimed at
one member are still serialized by that member's inbox.

## HTTP API

The remote API is under `/api/remote/v1` and uses a Bearer capability token. The
URL session id is authoritative; clients cannot reroute by putting a different
target in the JSON body.

| Method | Endpoint | Scope | Purpose |
| --- | --- | --- | --- |
| GET | `/sessions` | `session.state.read` | List sessions visible to the token |
| POST | `/sessions/:id/messages` | `session.message.send` | Queue a `next_turn` command |
| POST | `/sessions/:id/steer` | `session.steer` | Steer a live run |
| POST | `/sessions/:id/abort` | `session.abort` | Abort the live run |
| GET | `/sessions/:id/state` | `session.state.read` | Read runtime, queue, and attention state |
| GET | `/sessions/:id/events` | `session.events.read` | Snapshot plus replayable SSE lifecycle events |
| GET | `/commands/:id` | `session.messages.read` | Read command status and error metadata |

Message POSTs return `202` with `commandId`, session id, status, and queue
position. Send an `Idempotency-Key` header; retries with the same key and target
return the original receipt. Request bodies and idempotency keys are bounded.
Remote errors use stable codes such as `REMOTE_TOKEN_REQUIRED`,
`REMOTE_SCOPE_DENIED`, `SESSION_NOT_ALLOWED`, `SESSION_BUSY`,
`SESSION_QUEUE_FULL`, `COMMAND_DUPLICATE`, `COMMAND_EXPIRED`, and
`RUN_INTERRUPTED`.

SSE accepts `after=<cursor>` or `Last-Event-ID`. The server subscribes before
replaying, sends a snapshot, then sends lifecycle events with monotonic event
ids. It deliberately excludes prompt text, tool output, file contents, and
credentials.

## Capability tokens

Tokens are managed locally through `/api/remote/tokens`, which is protected by
Piora's existing local desktop/password boundary. A token is shown only once at
creation time. The on-disk store keeps only a SHA-256 token hash, scope list,
allowed session/room ids, timestamps, and revocation state. Token authentication
uses constant-time hash comparison, expiry/revocation checks, and a bounded
per-token/session rate limiter.

The settings panel creates a least-privilege token for a selected session and
shows the warning that remote prompts can modify files or execute commands with
that session's authority. Revoke tokens when no longer needed. Never put a raw
token in a command journal, event, log, URL, or client persistence.

## Optional WebSocket connector

The process-level connector is disabled unless both variables are set:

```text
PIORA_REMOTE_CONTROL_WS_URL=wss://control.example/ws
PIORA_REMOTE_CONTROL_WS_TOKEN=<opaque-token>
```

Optional settings are `PIORA_REMOTE_CONTROL_DEVICE_ID` and the comma-separated
local allow-list `PIORA_REMOTE_CONTROL_ALLOWED_SESSION_IDS`. The connector sends
a protocol hello with its last event cursor, accepts only `session.message`
commands for allow-listed sessions, dispatches through the same router, and
returns acknowledgements plus filtered lifecycle events. Reconnects use bounded
jittered exponential backoff. Tokens and message content are not logged.

## Operational guidance

Use the local status endpoint (`/api/remote/status`) to inspect connector state
and queue summaries without exposing secrets. Keep the server bound to a trusted
interface, use TLS for remote HTTP/WS transport, scope tokens to only the
required sessions, and rotate/revoke credentials after device changes. The
remote API intentionally bypasses the local desktop token only for
`/api/remote/v1/*`; host/origin checks still apply and the Bearer capability is
required on every remote request.

The main regression coverage is in
`lib/session-message-router.test.mjs`: same-session FIFO, cross-session overlap,
idempotent duplicate delivery, and queued-command recovery after router restart.
