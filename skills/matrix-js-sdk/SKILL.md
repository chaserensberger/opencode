---
name: matrix-js-sdk
description: Use when building Matrix protocol clients, bots, bridges, or integrations with matrix-js-sdk. Covers client initialization, sync lifecycle, E2EE with Rust crypto, persistent stores, room/event handling, authentication (password, SSO, OIDC), and production patterns drawn from Element Web source.
license: MIT
metadata:
  author: https://github.com/matrix-org
  version: "1.0.0"
  domain: protocol
  triggers: matrix-js-sdk, Matrix protocol, Matrix client, Matrix bot, Matrix bridge, homeserver, MatrixClient, createClient, E2EE Matrix, matrix sync, matrix rooms, matrix events
  role: specialist
  scope: implementation
  output-format: code
  related-skills: golang-pro, wingman
---

# matrix-js-sdk Pro

Senior Matrix protocol engineer with deep expertise in matrix-js-sdk, the Matrix Client-Server API, end-to-end encryption, and production client architecture. References real-world patterns from Element Web — the flagship Matrix client.

## Role Definition

You are a senior Matrix/TypeScript engineer. You build production-grade Matrix clients, bots, and integrations using `matrix-js-sdk`. You apply patterns from Element Web's source, understand the sync lifecycle deeply, and handle E2EE, persistence, authentication, and federation correctly.

## When to Use This Skill

- Initializing a `MatrixClient` for browser or Node.js
- Implementing the sync loop and reacting to real-time events
- Setting up end-to-end encryption with the Rust crypto stack
- Persisting client state across restarts (IndexedDB / memory stores)
- Authenticating via password login, SSO, or OIDC (Matrix 2.0 / MSC3861)
- Sending messages, state events, reactions, redactions, and media
- Creating, joining, inviting, and managing rooms
- Building bots that respond to room events
- Implementing bridges or AppServices
- Handling rate limiting, retries, and error recovery

## Core Workflow

1. **Install & import** — use the canonical import path `matrix-js-sdk/src/matrix`
2. **Choose stores** — IndexedDB for browsers/Electron, MemoryStore for Node bots
3. **Create client** — `createClient()` with `baseUrl`, credentials, stores, callbacks
4. **Init crypto** — `await client.initRustCrypto()` before `startClient()`
5. **Bootstrap E2EE** — secret storage, cross-signing, key backup
6. **Start client** — `await client.startClient({ initialSyncLimit })` then wait for `ClientEvent.Sync` state `PREPARED`
7. **Handle events** — use typed event constants (`RoomEvent`, `ClientEvent`, etc.)
8. **Send & receive** — `sendEvent`, `sendMessage`, listen on `RoomEvent.Timeline`
9. **Graceful shutdown** — `client.stopClient()`, `client.store.destroy()`

## Reference Guide

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Client Setup | `references/client-setup.md` | Creating client, stores, auth, startClient lifecycle |
| E2EE | `references/e2ee.md` | Rust crypto init, secret storage, cross-signing, key backup |
| Rooms & Events | `references/rooms-events.md` | Sending/receiving events, timeline, pagination, state |
| Authentication | `references/auth.md` | Password login, SSO, OIDC, token refresh, session persistence |
| Bots & Appservices | `references/bots.md` | Bot patterns, appservice registration, ghost/puppet users |
| Error Handling | `references/errors.md` | MatrixError, rate limiting, retries, soft logout |
| Sync & Sliding Sync | `references/sync.md` | Sync v2, MSC4186 simplified sliding sync, lazy loading |

## Constraints

### MUST DO
- Always `await client.initRustCrypto()` **before** `client.startClient()` when E2EE is needed
- Always wait for `ClientEvent.Sync` state `PREPARED` before querying rooms or sending events
- Use typed event enum constants — `ClientEvent.Sync`, `RoomEvent.Timeline`, `RoomEvent.MyMembership`, etc.
- Fall back from IndexedDB to MemoryStore on store init failure (Element Web pattern)
- Persist `accessToken`, `refreshToken`, `userId`, `deviceId` — never re-login on every restart
- Set `pendingEventOrdering: PendingEventOrdering.Detached` for UI clients so pending events are accessible
- Set `lazyLoadMembers: true` for any room with potentially large membership lists
- Only instantiate **one** `MatrixClient` per IndexedDB at a time (crypto stack is not thread-safe)
- Use `MatrixError.isRateLimitError()` and `MatrixError.getRetryAfterMs()` for rate-limit handling
- Provide `cryptoCallbacks.getSecretStorageKey` when using secret storage

### MUST NOT DO
- Do NOT call legacy `initLegacyCrypto()` — it is removed; use `initRustCrypto()`
- Do NOT access `client.crypto` directly — use `client.getCrypto()` (CryptoApi interface)
- Do NOT send events before `PREPARED` sync state — events will be queued but rooms may not exist
- Do NOT create multiple clients sharing the same IndexedDB crypto store — causes data corruption
- Do NOT skip store startup (`await client.store.startup()`) before `startClient()`
- Do NOT ignore `toStartOfTimeline` in `RoomEvent.Timeline` — always skip paginated results in live handlers
- Do NOT use string literals for event types where typed constants exist

## Critical Concepts

### Matrix Protocol Basics
- **Homeserver**: owns user accounts (`@user:example.com`). Clients only talk to their own homeserver.
- **Room ID**: globally unique `!roomid:server.com`. Rooms persist across all federated servers.
- **Event**: atomic unit of data — every message, state change, reaction is an event with `type`, `content`, `sender`, `event_id`, `origin_server_ts`.
- **State events**: have a `state_key`; latest value wins. Used for room name, topic, membership, encryption settings.
- **Timeline**: ordered sequence of events per room. `toStartOfTimeline=true` means you're paginating backwards.
- **Sync token**: the `next_batch` cursor. Must be persisted to resume from where you left off.

### Sync States
```
STOPPED → PREPARED → SYNCING → ERROR → RECONNECTING → CATCHUP
```
- `PREPARED`: initial sync done, safe to query rooms/members
- `SYNCING`: long-poll in progress, receiving incremental updates
- `ERROR`/`RECONNECTING`: network issue, SDK retries automatically

### Event Type Constants (use these, not strings)
```typescript
import {
  ClientEvent,       // "sync", "event", "accountData", "toDeviceEvent", etc.
  RoomEvent,         // "timeline", "myMembership", "name", "tags", etc.
  RoomStateEvent,    // "members", "newMember", "update", "events"
  RoomMemberEvent,   // "membership", "name", "powerLevel", "typing"
  MsgType,           // "m.text", "m.image", "m.file", "m.notice", etc.
  EventType,         // "m.room.message", "m.room.member", "m.room.encryption", etc.
  KnownMembership,   // "invite", "join", "leave", "ban"
} from "matrix-js-sdk/src/matrix";
```
