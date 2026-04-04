# Rooms & Events Reference

## Sending Messages

### Text message (most common)

```typescript
import { MsgType } from "matrix-js-sdk/src/matrix";

// Simple text
await client.sendMessage(roomId, {
  msgtype: MsgType.Text,
  body: "Hello, world!",
});

// HTML-formatted text
await client.sendMessage(roomId, {
  msgtype: MsgType.Text,
  body: "**bold** and _italic_",           // plain text fallback
  format: "org.matrix.custom.html",
  formatted_body: "<strong>bold</strong> and <em>italic</em>",
});

// Notice (for bots — renders differently in clients)
await client.sendMessage(roomId, {
  msgtype: MsgType.Notice,
  body: "Automated notification",
});
```

### Sending arbitrary events

```typescript
// sendEvent(roomId, eventType, content, txnId?)
const { event_id } = await client.sendEvent(
  roomId,
  "m.room.message",
  { msgtype: "m.text", body: "Hello" },
  "" // txnId — empty string lets the SDK generate one
);
```

### Replying to a message

```typescript
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

function buildReply(replyToEvent: MatrixEvent, replyBody: string) {
  const origSender = replyToEvent.getSender();
  const origBody = replyToEvent.getContent().body ?? "";
  const origId = replyToEvent.getId();

  return {
    msgtype: MsgType.Text,
    body: `> <${origSender}> ${origBody}\n\n${replyBody}`,
    "m.relates_to": {
      "m.in_reply_to": { event_id: origId },
    },
  };
}

await client.sendMessage(roomId, buildReply(event, "That's interesting!"));
```

### Reactions

```typescript
await client.sendEvent(roomId, "m.reaction", {
  "m.relates_to": {
    rel_type: "m.annotation",
    event_id: targetEventId,
    key: "👍",
  },
});
```

### Redacting events

```typescript
await client.redactEvent(roomId, eventId, undefined, { reason: "Spam" });
```

### Sending state events

```typescript
// Set room topic
await client.setRoomTopic(roomId, "Welcome to the Matrix!");

// Or directly:
await client.sendStateEvent(roomId, "m.room.topic", { topic: "My topic" }, "");

// Set room name
await client.setRoomName(roomId, "My Room");
```

## Receiving Events

### Live timeline events

```typescript
import { RoomEvent } from "matrix-js-sdk/src/matrix";

client.on(RoomEvent.Timeline, (event, room, toStartOfTimeline) => {
  // ALWAYS skip paginated (historical) results in live handlers
  if (toStartOfTimeline) return;

  // Filter to messages only
  if (event.getType() !== "m.room.message") return;

  // Ignore own messages in bots
  if (event.getSender() === client.getUserId()) return;

  const content = event.getContent();
  const body: string = content.body ?? "";
  const msgtype: string = content.msgtype ?? "";

  console.log(`[${room?.name}] ${event.getSender()}: ${body}`);
});
```

### Room membership changes

```typescript
import { RoomEvent, KnownMembership } from "matrix-js-sdk/src/matrix";

client.on(RoomEvent.MyMembership, (room, membership, prevMembership) => {
  if (membership === KnownMembership.Invite) {
    // Auto-join bot pattern
    client.joinRoom(room.roomId).catch(console.error);
  }
  if (membership === KnownMembership.Leave && prevMembership === KnownMembership.Join) {
    console.log(`Left room: ${room.roomId}`);
  }
});
```

### Typing notifications

```typescript
import { RoomMemberEvent } from "matrix-js-sdk/src/matrix";

client.on(RoomMemberEvent.Typing, (event, member) => {
  if (member.typing) {
    console.log(`${member.name} is typing in ${member.roomId}`);
  }
});

// Send your own typing notification
await client.sendTyping(roomId, true, 30000); // typing, 30s timeout
await client.sendTyping(roomId, false, 0);    // stopped typing
```

## Room Management

### Create a room

```typescript
const { room_id } = await client.createRoom({
  name: "My Room",
  topic: "Discussion room",
  visibility: "private",               // "public" | "private"
  preset: "private_chat",              // "private_chat" | "public_chat" | "trusted_private_chat"
  invite: ["@bob:example.com"],
  initial_state: [
    {
      type: "m.room.encryption",
      state_key: "",
      content: { algorithm: "m.megolm.v1.aes-sha2" },
    },
  ],
  power_level_content_override: {
    users_default: 0,
    events_default: 0,
  },
});
```

### Join / leave rooms

```typescript
// Join by room ID or alias
await client.joinRoom("!roomid:server.com");
await client.joinRoom("#myroom:server.com");

// Leave
await client.leave(roomId);

// Invite user
await client.invite(roomId, "@charlie:example.com");

// Kick
await client.kick(roomId, "@charlie:example.com", "Reason");

// Ban
await client.ban(roomId, "@charlie:example.com", "Reason");
```

### Room listing

```typescript
// Get all rooms the client is a member of
const rooms = client.getRooms();

// Get a specific room
const room = client.getRoom(roomId);
if (!room) throw new Error("Room not found — sync may not be PREPARED yet");

// Check membership
const membership = room.getMyMembership(); // "join" | "invite" | "leave" | "ban"
```

## Accessing Room State

```typescript
// Get current room state
const roomState = room.currentState;

// Get a specific state event
const encryptionEvent = roomState.getStateEvents("m.room.encryption", "");
const isEncrypted = !!encryptionEvent;

// Get all members
await room.loadMembersIfNeeded(); // needed if lazyLoadMembers: true
const members = roomState.getMembers();

// Get a specific member
const member = roomState.getMember("@alice:example.com");
const displayName = member?.name;
const powerLevel = member?.powerLevel; // 0-100
```

## Timeline & Pagination

```typescript
// Access the live timeline
const timeline = room.getLiveTimeline();
const events = timeline.getEvents();

// Paginate backwards (load older messages)
const canPaginate = client.paginationEnabled(timeline); // check first
if (canPaginate) {
  const gotMore = await client.paginateEventTimeline(timeline, {
    backwards: true,
    limit: 50,
  });
}

// Scroll back to a specific event
const eventTimeline = await client.getEventTimeline(
  room.getUnfilteredTimelineSet(),
  eventId
);
```

## Sending Media

```typescript
// Upload file first, then send
const uploadResponse = await client.uploadContent(fileBlob, {
  name: "photo.jpg",
  type: "image/jpeg",
  onlyContentUri: false,
});
const contentUri = uploadResponse.content_uri;

// Send image message
await client.sendMessage(roomId, {
  msgtype: MsgType.Image,
  body: "photo.jpg",
  url: contentUri,
  info: {
    mimetype: "image/jpeg",
    size: fileBlob.size,
    w: 1920,
    h: 1080,
  },
});
```

## Event Object API

```typescript
// Key MatrixEvent methods
event.getId()                // "$eventid:server.com"
event.getType()              // "m.room.message"
event.getSender()            // "@alice:server.com"
event.getContent()           // { msgtype, body, ... }
event.getRoomId()            // "!roomid:server.com"
event.getTs()                // Unix timestamp (ms)
event.isEncrypted()          // boolean
event.isRedacted()           // boolean
event.getRedactionReason()   // string | null
event.getRelation()          // m.relates_to content
event.replyEventId           // event ID this replies to
event.threadRootId           // thread root event ID if in a thread
event.status                 // EventStatus: "sending" | "sent" | "not_sent" | "cancelled"
```
