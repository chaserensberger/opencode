# Client Setup Reference

## Installation

```bash
npm install matrix-js-sdk
# or
pnpm add matrix-js-sdk
```

## Import Pattern

Always import from `matrix-js-sdk/src/matrix` (the primary entry point):

```typescript
import {
  createClient,
  ClientEvent,
  RoomEvent,
  RoomStateEvent,
  RoomMemberEvent,
  MsgType,
  EventType,
  KnownMembership,
  PendingEventOrdering,
  MemoryStore,
  IndexedDBStore,
  IndexedDBCryptoStore,
  MemoryCryptoStore,
  type MatrixClient,
  type ICreateClientOpts,
  type IStartClientOpts,
} from "matrix-js-sdk/src/matrix";
```

## Store Selection Strategy

Element Web uses this pattern — prefer IndexedDB, fall back to memory:

```typescript
import {
  createClient,
  IndexedDBStore,
  IndexedDBCryptoStore,
  MemoryStore,
  MemoryCryptoStore,
  LocalStorageCryptoStore,
} from "matrix-js-sdk/src/matrix";

function createPersistentClient(opts: ICreateClientOpts): MatrixClient {
  const storeOpts: Partial<ICreateClientOpts> = {};

  // Sync store: where rooms, timelines, and sync tokens are cached
  if (typeof window !== "undefined" && window.indexedDB && window.localStorage) {
    storeOpts.store = new IndexedDBStore({
      indexedDB: window.indexedDB,
      dbName: "my-app-sync",
      localStorage: window.localStorage,
    });
  } else if (typeof window !== "undefined" && window.localStorage) {
    storeOpts.store = new MemoryStore({ localStorage: window.localStorage });
  }
  // For Node.js (bots/servers), omit store or use MemoryStore:
  // storeOpts.store = new MemoryStore({});

  // Crypto store: where E2EE keys are stored
  // IMPORTANT: used only for migration from legacy crypto to Rust crypto
  if (typeof window !== "undefined" && window.indexedDB) {
    storeOpts.cryptoStore = new IndexedDBCryptoStore(
      window.indexedDB,
      "matrix-js-sdk:crypto"
    );
  } else if (typeof window !== "undefined" && window.localStorage) {
    storeOpts.cryptoStore = new LocalStorageCryptoStore(window.localStorage);
  } else {
    storeOpts.cryptoStore = new MemoryCryptoStore();
  }

  return createClient({ ...storeOpts, ...opts });
}
```

## Full Production Client Initialization

```typescript
import {
  createClient,
  ClientEvent,
  PendingEventOrdering,
  type MatrixClient,
} from "matrix-js-sdk/src/matrix";

interface SessionCredentials {
  homeserverUrl: string;
  userId: string;
  accessToken: string;
  deviceId: string;
  refreshToken?: string;
  pickleKey?: string; // for encrypting the crypto store
}

async function initMatrixClient(creds: SessionCredentials): Promise<MatrixClient> {
  const client = createPersistentClient({
    baseUrl: creds.homeserverUrl,
    userId: creds.userId,
    accessToken: creds.accessToken,
    deviceId: creds.deviceId,
    refreshToken: creds.refreshToken,
    pickleKey: creds.pickleKey,

    // Required for proper local echo and pending event tracking in UIs
    // pendingEventOrdering: PendingEventOrdering.Detached,

    // Poll for client .well-known every 2 hours
    clientWellKnownPollPeriod: 2 * 60 * 60,

    // Support threads (Matrix 1.4+)
    threadSupport: true,

    // Crypto callbacks — REQUIRED when using secret storage
    cryptoCallbacks: {
      getSecretStorageKey: async ({ keys }) => {
        // Prompt the user to enter their recovery key
        // Return [keyId, Uint8Array] or null to cancel
        const keyId = Object.keys(keys)[0];
        const key = await promptUserForKey(keyId);
        return key ? [keyId, key] : null;
      },
    },
  });

  // IMPORTANT: Always initialize the store before startClient
  try {
    await client.store.startup();
  } catch (err) {
    // Fall back to in-memory store if IndexedDB fails
    console.error("Store init failed, falling back to memory store:", err);
    client.store = new MemoryStore({ localStorage: window.localStorage });
  }

  // Initialize Rust crypto BEFORE startClient
  await client.initRustCrypto();

  return client;
}

async function startClient(client: MatrixClient): Promise<void> {
  const startOpts: IStartClientOpts = {
    initialSyncLimit: 20,
    lazyLoadMembers: true,      // Don't load all members upfront
    threadSupport: true,
  };

  // Wait for PREPARED before resolving
  await new Promise<void>((resolve, reject) => {
    client.once(ClientEvent.Sync, (state, _prev, _data) => {
      if (state === "PREPARED") {
        resolve();
      } else if (state === "ERROR") {
        reject(new Error("Initial sync failed"));
      }
    });
    client.startClient(startOpts);
  });
}
```

## Startup Sequence (correct order)

```typescript
// 1. Create client (no network calls yet)
const client = createPersistentClient({ baseUrl, userId, accessToken, deviceId });

// 2. Init store (opens IndexedDB, loads cached state)
await client.store.startup();

// 3. Init crypto (MUST be before startClient)
await client.initRustCrypto({ storageKey: rustCryptoKey });

// 4. Bootstrap E2EE secrets (see e2ee.md)
await bootstrapE2EE(client);

// 5. Start sync loop
await client.startClient({ initialSyncLimit: 20, lazyLoadMembers: true });

// 6. Wait for PREPARED
await waitForPrepared(client);

// 7. Now safe to query rooms, send events, etc.
const rooms = client.getRooms();
```

## Graceful Shutdown

```typescript
async function stopClient(client: MatrixClient): Promise<void> {
  client.stopClient();
  await client.store.destroy?.();
}
```

## Node.js Bot Minimal Setup (no E2EE, no persistence)

```typescript
import { createClient, ClientEvent, RoomEvent, MsgType } from "matrix-js-sdk/src/matrix";

const client = createClient({
  baseUrl: "https://matrix.example.com",
  userId: "@bot:example.com",
  accessToken: process.env.BOT_ACCESS_TOKEN!,
  deviceId: process.env.BOT_DEVICE_ID!,
});

client.once(ClientEvent.Sync, (state) => {
  if (state === "PREPARED") {
    console.log("Bot ready");
  }
});

client.on(RoomEvent.Timeline, (event, room, toStartOfTimeline) => {
  if (toStartOfTimeline) return; // skip paginated history
  if (event.getType() !== "m.room.message") return;
  if (event.getSender() === client.getUserId()) return; // ignore own messages

  const body: string = event.getContent().body ?? "";
  if (body.startsWith("!ping")) {
    client.sendMessage(room!.roomId, { msgtype: MsgType.Notice, body: "pong" });
  }
});

await client.startClient({ initialSyncLimit: 0 });
```
