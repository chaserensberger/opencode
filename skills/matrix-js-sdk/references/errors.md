# Error Handling Reference

## MatrixError

All Matrix API errors throw `MatrixError` (a subclass of `Error`):

```typescript
import { MatrixError, HTTPError } from "matrix-js-sdk/src/matrix";

try {
  await client.sendMessage(roomId, { msgtype: "m.text", body: "Hello" });
} catch (err) {
  if (err instanceof MatrixError) {
    console.error("Matrix error:", err.errcode, err.message);
    // err.errcode: string  — "M_FORBIDDEN", "M_LIMIT_EXCEEDED", "M_UNKNOWN_TOKEN", etc.
    // err.data:   object  — raw JSON from homeserver
    // err.httpStatus: number — HTTP status code
    // err.url:    string  — the URL that was called

    switch (err.errcode) {
      case "M_FORBIDDEN":
        // User doesn't have permission
        break;
      case "M_UNKNOWN_TOKEN":
        // Access token invalid — need to re-login or refresh
        handleUnknownToken(err);
        break;
      case "M_LIMIT_EXCEEDED":
        // Rate limited — retry after delay
        await handleRateLimit(err);
        break;
      case "M_NOT_FOUND":
        // Room or event doesn't exist
        break;
      case "M_ROOM_IN_USE":
        // Room alias already taken
        break;
    }
  } else if (err instanceof HTTPError) {
    console.error("HTTP error:", err.httpStatus);
  } else {
    throw err; // re-throw unexpected errors
  }
}
```

## Rate Limiting

The SDK automatically retries rate-limited requests for message sends. For manual API calls:

```typescript
import { MatrixError } from "matrix-js-sdk/src/matrix";

async function callWithRateLimitRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 5
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof MatrixError && err.isRateLimitError()) {
        // Use server-recommended delay, or default to exponential backoff
        const retryAfterMs = err.getRetryAfterMs() ?? Math.min(1000 * 2 ** attempt, 30000);
        console.warn(`Rate limited. Retrying in ${retryAfterMs}ms (attempt ${attempt + 1})`);
        await sleep(retryAfterMs);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Max retries exceeded");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

## Token Expiry & Soft Logout

```typescript
import { ClientEvent, MatrixError } from "matrix-js-sdk/src/matrix";

// Listen for session invalidation
client.on(ClientEvent.SessionLoggedOut, (err) => {
  // err.errcode === "M_UNKNOWN_TOKEN" — token no longer valid
  // err.data?.soft_logout: boolean — if true, user's messages are still accessible
  if (err.data?.soft_logout) {
    // Offer re-login, preserving local cache
    promptReLogin();
  } else {
    // Hard logout — clear everything
    clearSession();
  }
});

// M_UNKNOWN_TOKEN with soft_logout: true means:
// - the token expired (access token rotation in use)
// - user's history is still on the server
// - just re-authenticate and continue

// M_UNKNOWN_TOKEN with soft_logout: false (or absent):
// - the user was explicitly logged out
// - clear local state
```

## Sync Error Handling

```typescript
import { ClientEvent, SyncState } from "matrix-js-sdk/src/matrix";

client.on(ClientEvent.Sync, (state, prevState, data) => {
  switch (state) {
    case SyncState.Prepared:
      console.log("Ready");
      break;
    case SyncState.Syncing:
      // Normal operation
      break;
    case SyncState.Error:
      // data?.error is a MatrixError
      console.error("Sync error:", data?.error);
      // SDK will retry automatically with exponential backoff
      break;
    case SyncState.Reconnecting:
      // Network connectivity issue, SDK is retrying
      showOfflineIndicator();
      break;
    case SyncState.Stopped:
      // client.stopClient() was called
      break;
  }
});
```

## Store Failure (Element Web pattern)

Handle unexpected IndexedDB close gracefully:

```typescript
client.store.on?.("closed", async () => {
  // The IndexedDB store was unexpectedly closed (tab competing, browser bug, etc.)
  client.stopClient();
  client.store.destroy();
  // Prompt user to reload — do NOT silently fall back in UI clients
  // as this could cause state desync
  promptUserToReload();
});
```

## Common Error Codes

| errcode | Meaning | Action |
|---------|---------|--------|
| `M_FORBIDDEN` | No permission | Show error to user |
| `M_UNKNOWN_TOKEN` | Token invalid/expired | Refresh token or re-login |
| `M_LIMIT_EXCEEDED` | Rate limited | Retry after `retry_after_ms` |
| `M_NOT_FOUND` | Resource doesn't exist | Show "not found" to user |
| `M_ROOM_IN_USE` | Room alias taken | Suggest different alias |
| `M_INVALID_PARAM` | Bad request parameter | Fix request |
| `M_TOO_LARGE` | Payload too large | Reduce payload size |
| `M_CONSENT_NOT_GIVEN` | User hasn't accepted ToS | Redirect to consent URL |
| `M_USER_DEACTIVATED` | User account deactivated | Show logout |
| `M_UNRECOGNIZED` | Unknown endpoint | Check SDK/server version |

## Send Event Error Handling

```typescript
import { EventStatus } from "matrix-js-sdk/src/matrix";

// After sendEvent/sendMessage, check event status in the room
client.on(RoomEvent.LocalEchoUpdated, (event, room, oldEventId) => {
  if (event.status === EventStatus.NOT_SENT) {
    console.error("Event failed to send:", event.error?.message);
    // event.error is a MatrixError
    // The SDK will retry automatically for network errors
    // For persistent failures, you can:
    // await client.resendEvent(event, room);
    // or
    // await client.cancelPendingEvent(event);
  }
});
```

## Handling Decryption Failures

```typescript
import { MatrixEventEvent } from "matrix-js-sdk/src/matrix";

client.on(MatrixEventEvent.Decrypted, (event, err) => {
  if (err) {
    // Common reasons:
    // - "MEGOLM_UNKNOWN_INBOUND_SESSION_ID": missing session key
    //   (device wasn't online when key was sent, key backup needed)
    // - "OLM_UNKNOWN_MESSAGE_INDEX": key was rotated/compromised
    // - "DECRYPTION_FAILURE": generic failure
    console.warn("Decryption failure:", event.decryptionFailureReason, event.getId());

    // Request key from sender (automatic in most cases)
    // client.getCrypto()?.requestRoomKey(event);
  }
});
```
