# Sync & Sliding Sync Reference

## Standard Sync (v2)

The default sync mechanism. Polls `/sync` with a long-poll timeout and a `since` token.

```typescript
import { ClientEvent, SyncState } from "matrix-js-sdk/src/matrix";

// Wait for initial sync to complete
function waitForPrepared(client: MatrixClient): Promise<void> {
  return new Promise((resolve, reject) => {
    const currentState = client.getSyncState();
    if (currentState === SyncState.Prepared) {
      resolve();
      return;
    }
    client.once(ClientEvent.Sync, (state) => {
      if (state === SyncState.Prepared) resolve();
      else reject(new Error(`Unexpected sync state: ${state}`));
    });
  });
}

// Start with good defaults
await client.startClient({
  initialSyncLimit: 20,    // events to load per room on initial sync
  lazyLoadMembers: true,   // load members only when needed (critical for large rooms)
  threadSupport: true,     // enable thread support (Matrix 1.4+)
  // pendingEventOrdering: PendingEventOrdering.Detached, // for UI clients
});

await waitForPrepared(client);
```

## Simplified Sliding Sync (MSC4186 / Matrix 2.0)

Native sliding sync is supported in Synapse 1.114+ and is the recommended sync mechanism for new clients targeting Matrix 2.0. It provides:
- Instant initial load (only syncs rooms you're viewing)
- Room list with lazy loading
- Significantly faster startup for users with many rooms

> **Status**: MSC4186 is implemented in Synapse but not yet stable in matrix-js-sdk. Element Web enables it via a lab flag. Monitor the SDK changelog for stable support.

```typescript
import {
  SlidingSync,
  SlidingSyncEvent,
  type MSC3575List,
} from "matrix-js-sdk/src/sliding-sync";

// Check if the homeserver supports native sliding sync
async function checkSlidingSyncSupport(client: MatrixClient): Promise<boolean> {
  const wellKnown = await client.fetchClientWellKnown().catch(() => null);
  const versions = await client.getVersions().catch(() => null);
  // MSC4186 native support detected via server capabilities
  return !!(wellKnown || versions); // actual detection logic varies by SDK version
}

// Basic sliding sync setup (when stable API is available)
// See Element Web's SlidingSyncManager.ts for the full production implementation
```

## Sync State Machine

```
STOPPED
   ↓ startClient()
PREPARED  ←──────────────────────────────────────┐
   ↓                                              │
SYNCING  ──→ ERROR/RECONNECTING (auto-retry) ────┘
   ↓
STOPPED (on stopClient())
```

```typescript
client.on(ClientEvent.Sync, (newState, prevState, data) => {
  // newState: SyncState enum
  // prevState: previous state
  // data: { error?, nextSyncToken?, nextRetryDelay? }

  if (newState === SyncState.Syncing && prevState === SyncState.Prepared) {
    // Transition from initial sync to live sync
    console.log("Now receiving live events");
  }
  if (newState === SyncState.Reconnecting) {
    // Network issue — SDK is retrying with exponential backoff
    // Do NOT stop the client — it will recover automatically
  }
});
```

## Lazy Loading Members

With `lazyLoadMembers: true`, room members are not loaded upfront. Load them on demand:

```typescript
// Load members when entering a room (e.g., for a member list panel)
const room = client.getRoom(roomId)!;
await room.loadMembersIfNeeded();
const members = room.currentState.getMembers();

// Or load just the joined members
const joinedMembers = members.filter(
  (m) => m.membership === KnownMembership.Join
);
```

## Timeline Gaps & Resets

The live timeline can be reset when the server sends a new sync token with no `prev_batch`:

```typescript
import { RoomEvent } from "matrix-js-sdk/src/matrix";

client.on(RoomEvent.TimelineReset, (room, timelineSet, liveTimelineOnly) => {
  // The live timeline was replaced — scroll to bottom / refresh UI
  console.log(`Timeline reset for ${room?.roomId}`);
});
```

## Presence

```typescript
// Set presence (available / unavailable / offline)
await client.setSyncPresence("online");   // "online" | "unavailable" | "offline"

// Disable presence entirely (for bots / privacy)
// Set presence in startClient options:
await client.startClient({
  // ... other opts
  // Omit presence or set explicitly
});
```

## Account Data

Account data is per-user metadata stored on the homeserver (not in rooms):

```typescript
// Read
const data = client.getAccountData("my.custom.type");
const content = data?.getContent();

// Write
await client.setAccountData("my.custom.type", { key: "value" });

// Listen for changes
client.on(ClientEvent.AccountData, (event) => {
  if (event.getType() === "my.custom.type") {
    console.log("Account data updated:", event.getContent());
  }
});
```

## Direct Messages (DMs)

```typescript
// Get DM room for a user
const dmRooms = client.getAccountData("m.direct");
const dmMap: Record<string, string[]> = dmRooms?.getContent() ?? {};
const dmRoomIds = dmMap["@alice:example.com"] ?? [];

// Create a DM room
const { room_id } = await client.createRoom({
  preset: "trusted_private_chat",
  invite: ["@alice:example.com"],
  is_direct: true,
});

// Mark room as DM in account data
await client.setAccountData("m.direct", {
  ...dmMap,
  "@alice:example.com": [...(dmMap["@alice:example.com"] ?? []), room_id],
});
```

## Sync Token Persistence

The sync token (`next_batch`) is persisted in your store automatically when using `IndexedDBStore`. If using `MemoryStore`, persist it manually:

```typescript
// If using a custom/manual sync approach, access the token:
const syncToken = client.store.getSyncToken();
// Persist syncToken to disk...

// On restart, provide it (IndexedDBStore does this automatically):
const store = new MemoryStore({});
store.setSyncToken(persistedSyncToken);
```
