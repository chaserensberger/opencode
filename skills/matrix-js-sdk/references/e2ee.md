# End-to-End Encryption Reference

## Overview

matrix-js-sdk uses the **Rust crypto stack** (`matrix-sdk-crypto` via WebAssembly) as of v19+. The legacy `initLegacyCrypto()` is removed. Always use `initRustCrypto()`.

The crypto stack is **not thread-safe** — only one `MatrixClient` instance may use a given IndexedDB at a time.

## Full E2EE Setup Flow

```typescript
import {
  createClient,
  type MatrixClient,
  type CryptoCallbacks,
} from "matrix-js-sdk/src/matrix";
import {
  type CryptoApi,
} from "matrix-js-sdk/src/crypto-api";

// Step 1: Create client with cryptoCallbacks
const client = createClient({
  baseUrl: "https://matrix.example.com",
  userId: "@alice:example.com",
  accessToken: myAccessToken,
  deviceId: myDeviceId,

  cryptoCallbacks: {
    // Called when secret storage needs to be unlocked
    // Must return [keyId, Uint8Array key] or null to cancel
    getSecretStorageKey: async ({ keys }) => {
      const keyId = await getDefaultKeyId(keys);
      const rawKey = await promptUserForRecoveryKey(keyId);
      return rawKey ? [keyId, rawKey] : null;
    },
  },
});

// Step 2: Init store
await client.store.startup();

// Step 3: Init Rust crypto — MUST be before startClient
// Optionally encrypt the crypto IndexedDB with a 32-byte key
const rustCryptoKey = await deriveCryptoKey(userId); // your own key derivation
await client.initRustCrypto({
  storageKey: rustCryptoKey,   // Uint8Array(32) - encrypts the IDB store
  // storagePassword: "...",   // alternative: derive key from password (slower)
});

// Step 4: Bootstrap secret storage (4S) — idempotent, safe to call every startup
const crypto = client.getCrypto()!;
await crypto.bootstrapSecretStorage({
  // Called only if no secret storage key exists yet
  createSecretStorageKey: async () => {
    const newKey = generateRecoveryKey();
    await showUserRecoveryKey(newKey); // user MUST save this
    return newKey;
  },
});

// Step 5: Bootstrap cross-signing — idempotent
await crypto.bootstrapCrossSigning({
  authUploadDeviceSigningKeys: async (makeRequest) => {
    // User authentication required to upload cross-signing keys
    const authDict = await getUserInteractiveAuth();
    return makeRequest(authDict);
  },
});

// Step 6: Ensure key backup exists
const keyBackup = await crypto.checkKeyBackupAndEnable();
if (!keyBackup) {
  await crypto.resetKeyBackup();
}

// Step 7: Start client
await client.startClient({ initialSyncLimit: 20, lazyLoadMembers: true });
```

## Checking Encryption Status

```typescript
// Is this room encrypted?
const room = client.getRoom(roomId);
const isEncrypted = await client.getCrypto()!.isEncryptionEnabledInRoom(roomId);

// Get encryption info for an event
const crypto = client.getCrypto()!;
const eventEncryptionInfo = await crypto.getEncryptionInfoForEvent(event);
// eventEncryptionInfo.shieldColour: "green" | "grey" | "red" | "none"
// eventEncryptionInfo.shieldReasonCode: why it's not green
```

## Enabling Encryption in a New Room

```typescript
// When creating a room:
await client.createRoom({
  initial_state: [
    {
      type: "m.room.encryption",
      state_key: "",
      content: { algorithm: "m.megolm.v1.aes-sha2" },
    },
  ],
  // ...other opts
});

// Or enable in an existing room:
await client.sendStateEvent(roomId, "m.room.encryption", {
  algorithm: "m.megolm.v1.aes-sha2",
});
```

## Decryption Events

```typescript
import { MatrixEventEvent } from "matrix-js-sdk/src/matrix";

// Listen for events that failed to decrypt
client.on(MatrixEventEvent.Decrypted, (event) => {
  if (event.decryptionFailureReason) {
    console.error("Decryption failed:", event.decryptionFailureReason, event.getId());
  }
});

// Check if an event is encrypted and decrypted
const isEncryptedEvent = event.isEncrypted();
const isDecrypted = !event.isBeingDecrypted() && !event.decryptionFailureReason;
```

## Device Verification

```typescript
import { VerificationMethod } from "matrix-js-sdk/src/types";

// Request verification of another user's device
const verificationRequest = await client.getCrypto()!.requestDeviceVerification(
  "@bob:example.com",
  "BOBDEVICEID"
);

// Configure allowed verification methods when creating client
const client = createClient({
  // ...
  verificationMethods: [
    VerificationMethod.Sas,         // emoji/decimal comparison
    VerificationMethod.ShowQrCode,  // QR code display
    VerificationMethod.Reciprocate, // QR code scan
  ],
});
```

## Migrating from Legacy Crypto

If your app previously used `initLegacyCrypto()`:

```typescript
// Provide the legacy store + pickleKey so migration happens automatically
const client = createClient({
  baseUrl,
  accessToken,
  userId,
  deviceId,

  // REQUIRED for migration
  cryptoStore: myLegacyCryptoStore,
  pickleKey: myPickleKey,

  cryptoCallbacks: { ... },
});

// Migration runs automatically on first call to initRustCrypto
await client.initRustCrypto();

// Track migration progress
client.on(
  "CryptoEvent.LegacyCryptoStoreMigrationProgress" as any,
  (progress: number, total: number) => {
    if (progress === -1 && total === -1) {
      console.log("Migration complete");
    } else {
      console.log(`Migration: ${progress}/${total}`);
    }
  }
);
```

## Device Isolation Mode (Element Web pattern)

```typescript
// Prevent sending messages to unverified devices in a room
// This trades security for usability — only enable if your UX supports it
await client.getCrypto()!.setGlobalErrorOnUnknownDevices(true);

// OR set per-room:
room.setBlacklistUnverifiedDevices(true);
```

## Key Concepts

- **Secret Storage (4S)**: server-side encrypted backup of private cross-signing keys, guarded by a recovery key the user holds
- **Cross-signing**: allows verifying all devices of a user by verifying just the user's master key
- **Key backup**: server-side backup of Megolm session keys so encrypted history can be recovered on new devices
- **Megolm**: group encryption algorithm used for room messages (one session key per sender per room, rotated periodically)
- **Olm**: 1-to-1 ratchet used to share Megolm session keys between devices via `m.room.encrypted` to-device messages
