# Bots & AppServices Reference

## Simple Bot Pattern

```typescript
import {
  createClient,
  ClientEvent,
  RoomEvent,
  KnownMembership,
  MsgType,
  type MatrixClient,
} from "matrix-js-sdk/src/matrix";

class MatrixBot {
  private client: MatrixClient;

  constructor(
    private homeserverUrl: string,
    private userId: string,
    private accessToken: string,
    private deviceId: string,
  ) {
    this.client = createClient({
      baseUrl: homeserverUrl,
      userId,
      accessToken,
      deviceId,
    });
  }

  async start(): Promise<void> {
    // Auto-join rooms when invited
    this.client.on(RoomEvent.MyMembership, async (room, membership) => {
      if (membership === KnownMembership.Invite) {
        try {
          await this.client.joinRoom(room.roomId);
          console.log(`Joined room: ${room.roomId}`);
        } catch (err) {
          console.error(`Failed to join ${room.roomId}:`, err);
        }
      }
    });

    // Handle messages
    this.client.on(RoomEvent.Timeline, async (event, room, toStartOfTimeline) => {
      if (toStartOfTimeline) return;            // skip history
      if (event.getType() !== "m.room.message") return;
      if (event.getSender() === this.userId) return; // ignore own messages
      if (event.isEncrypted() && event.decryptionFailureReason) return; // skip undecryptable

      const body: string = event.getContent()?.body ?? "";
      if (!body.startsWith("!")) return;

      await this.handleCommand(room!.roomId, event.getId()!, body);
    });

    await new Promise<void>((resolve) => {
      this.client.once(ClientEvent.Sync, (state) => {
        if (state === "PREPARED") resolve();
      });
      this.client.startClient({ initialSyncLimit: 0 }); // 0 = don't load history
    });

    console.log(`Bot ${this.userId} ready`);
  }

  private async handleCommand(roomId: string, eventId: string, body: string): Promise<void> {
    const [cmd, ...args] = body.slice(1).split(" ");

    switch (cmd.toLowerCase()) {
      case "ping":
        await this.client.sendMessage(roomId, {
          msgtype: MsgType.Notice,
          body: "pong",
          "m.relates_to": { "m.in_reply_to": { event_id: eventId } },
        });
        break;
      case "help":
        await this.client.sendMessage(roomId, {
          msgtype: MsgType.Notice,
          body: "Commands: !ping, !help",
        });
        break;
    }
  }

  async stop(): Promise<void> {
    this.client.stopClient();
  }
}

// Usage
const bot = new MatrixBot(
  "https://matrix.example.com",
  "@mybot:example.com",
  process.env.BOT_ACCESS_TOKEN!,
  process.env.BOT_DEVICE_ID!,
);
await bot.start();
```

## Bot with E2EE Support

For bots that need to participate in encrypted rooms:

```typescript
import {
  createClient,
  ClientEvent,
  RoomEvent,
  KnownMembership,
  MsgType,
  MemoryStore,
} from "matrix-js-sdk/src/matrix";

// For a bot: use MemoryStore (no browser IndexedDB needed)
// WARNING: with MemoryStore, a new device is created on every restart
// → use a persistent store (e.g., SQLite via a custom store) in production

const client = createClient({
  baseUrl: "https://matrix.example.com",
  userId: "@encryptedbot:example.com",
  accessToken: process.env.BOT_ACCESS_TOKEN!,
  deviceId: process.env.BOT_DEVICE_ID!, // MUST persist this across restarts
  store: new MemoryStore({}),
  cryptoCallbacks: {
    getSecretStorageKey: async () => null, // bots usually skip secret storage
  },
});

// Node.js: use ephemeral in-memory crypto store
await client.initRustCrypto({ useIndexedDB: false });

client.on(RoomEvent.MyMembership, async (room, membership) => {
  if (membership === KnownMembership.Invite) {
    await client.joinRoom(room.roomId);
  }
});

client.on(RoomEvent.Timeline, async (event, room, toStartOfTimeline) => {
  if (toStartOfTimeline) return;
  if (event.getType() !== "m.room.message") return;
  if (event.getSender() === client.getUserId()) return;

  // If in encrypted room, event will be auto-decrypted
  const body = event.getContent()?.body ?? "";
  if (body === "!ping") {
    await client.sendMessage(room!.roomId, {
      msgtype: MsgType.Notice,
      body: "pong",
    });
  }
});

await client.startClient({ initialSyncLimit: 0 });
```

## AppService (Bridge) Registration

AppServices register with a homeserver and can manage namespaces of users/rooms:

```yaml
# registration.yaml
id: "my-bridge"
hs_token: "secret-token-homeserver-sends"
as_token: "secret-token-appservice-sends"
namespaces:
  users:
    - exclusive: true
      regex: "@bridge_.*:example.com"
  aliases:
    - exclusive: true
      regex: "#bridge_.*:example.com"
  rooms: []
url: "http://localhost:3000"
sender_localpart: "bridgebot"
rate_limited: false
protocols:
  - my-protocol
```

For bridges, use the [`matrix-appservice-bridge`](https://github.com/matrix-org/matrix-appservice-bridge) library which wraps matrix-js-sdk with AppService-specific functionality. It handles:
- Ghost user creation and management
- Intent objects per user
- Automatic registration file handling
- State store and room bridging database

```typescript
import { Bridge, Intent, MatrixUser, RemoteUser, RoomBridgeStore } from "matrix-appservice-bridge";

const bridge = new Bridge({
  homeserverUrl: "https://matrix.example.com",
  domain: "example.com",
  registration: "registration.yaml",
  controller: {
    onUserQuery: (queriedUser) => {
      // Return provisioning info for ghost users
      return {}; // empty means: just create the user
    },
    onEvent: async (request, context) => {
      const event = request.getData();
      if (event.type !== "m.room.message") return;

      // Get an Intent for the bridge bot user
      const intent: Intent = bridge.getIntent();
      await intent.sendText(event.room_id, `Echo: ${event.content.body}`);
    },
  },
});

await bridge.run(3000);
```

## Avoiding Common Bot Pitfalls

### Don't process your own messages
```typescript
if (event.getSender() === client.getUserId()) return;
```

### Don't process historical messages
```typescript
if (toStartOfTimeline) return;
```

### Don't process server notices
```typescript
if (event.getContent()?.msgtype === "m.server_notice") return;
```

### Don't respond to non-text events
```typescript
const msgtype = event.getContent()?.msgtype;
if (!msgtype || !msgtype.startsWith("m.text")) return;
```

### Use `m.notice` for bot messages
```typescript
// Bot responses should use m.notice, not m.text
// m.notice renders with muted styling in clients and suppresses notifications
await client.sendMessage(roomId, {
  msgtype: MsgType.Notice,  // NOT MsgType.Text
  body: "I am a bot response",
});
```

### Device ID persistence for E2EE bots
If a bot uses E2EE, it MUST persist its `deviceId` across restarts. New deviceId = new E2EE device = must re-establish sessions with all room members. Store `deviceId` in your bot's configuration/database.

## Rate Limiting for Bots

Many homeservers are set to `rate_limited: false` for appservice bots. For regular bots, implement delays:

```typescript
class RateLimitedBot {
  private sendQueue: Array<() => Promise<void>> = [];
  private processing = false;

  async queueSend(fn: () => Promise<void>): Promise<void> {
    this.sendQueue.push(fn);
    if (!this.processing) this.processQueue();
  }

  private async processQueue(): Promise<void> {
    this.processing = true;
    while (this.sendQueue.length > 0) {
      const fn = this.sendQueue.shift()!;
      try {
        await fn();
      } catch (err) {
        if (err instanceof MatrixError && err.isRateLimitError()) {
          const delay = err.getRetryAfterMs() ?? 1000;
          this.sendQueue.unshift(fn); // re-queue
          await sleep(delay);
        } else {
          console.error("Send failed:", err);
        }
      }
      await sleep(50); // 20 req/s max
    }
    this.processing = false;
  }
}
```
