# Authentication Reference

## Password Login

```typescript
import { createClient } from "matrix-js-sdk/src/matrix";

// Step 1: Discover the homeserver URL from the user's MXID or domain
async function discoverHomeserver(userIdOrDomain: string): Promise<string> {
  // Well-known lookup: GET https://<domain>/.well-known/matrix/client
  const domain = userIdOrDomain.includes(":")
    ? userIdOrDomain.split(":")[1]
    : userIdOrDomain;

  const tempClient = createClient({ baseUrl: `https://${domain}` });
  const wellKnown = await tempClient.fetchClientWellKnown();
  return wellKnown?.["m.homeserver"]?.base_url ?? `https://${domain}`;
}

// Step 2: Login
async function loginWithPassword(homeserverUrl: string, username: string, password: string) {
  const client = createClient({ baseUrl: homeserverUrl });

  const response = await client.login("m.login.password", {
    identifier: {
      type: "m.id.user",
      user: username,     // localpart or full MXID
    },
    password,
    initial_device_display_name: "My App",
    // Request refresh token support (Matrix 1.3+)
    // refresh_token: true,  // set if homeserver supports it
  });

  // Persist these — do NOT re-login on every restart
  return {
    homeserverUrl,
    userId: response.user_id,
    accessToken: response.access_token,
    deviceId: response.device_id,
    refreshToken: response.refresh_token, // may be undefined
  };
}
```

## Token-Based Login (Resume Session)

The standard pattern for all production apps — store credentials and reuse them:

```typescript
async function resumeSession(storedCreds: SessionCredentials): Promise<MatrixClient> {
  const client = createPersistentClient({
    baseUrl: storedCreds.homeserverUrl,
    userId: storedCreds.userId,
    accessToken: storedCreds.accessToken,
    deviceId: storedCreds.deviceId,
    refreshToken: storedCreds.refreshToken,
    // Token refresh callback (for non-OIDC refresh token support)
    tokenRefreshFunction: storedCreds.refreshToken
      ? makeTokenRefresher(storedCreds)
      : undefined,
  });
  return client;
}

// Implement a token refresh function for standard Matrix refresh tokens
function makeTokenRefresher(storedCreds: SessionCredentials) {
  return async (refreshToken: string) => {
    // Call /refresh endpoint
    const tempClient = createClient({ baseUrl: storedCreds.homeserverUrl });
    const resp = await tempClient.refreshToken(refreshToken);
    // Persist new tokens
    await persistTokens(resp.access_token, resp.refresh_token);
    return {
      accessToken: resp.access_token,
      refreshToken: resp.refresh_token,
    };
  };
}
```

## SSO Login

```typescript
import { createClient, SSOAction } from "matrix-js-sdk/src/matrix";

// Get SSO login URL
const client = createClient({ baseUrl: homeserverUrl });
const ssoUrl = client.getSsoLoginUrl(
  "https://myapp.com/callback",  // redirectUrl
  "sso",                          // loginType: "sso" | "cas"
  undefined,                      // idpId (optional, for multiple providers)
  SSOAction.LOGIN
);

// Redirect user to ssoUrl...
// After redirect back with ?loginToken=...:
const loginToken = new URLSearchParams(window.location.search).get("loginToken")!;
const resp = await client.login("m.login.token", {
  token: loginToken,
  initial_device_display_name: "My App",
});
```

## OIDC / Native Matrix Auth (Matrix 2.0 / MSC3861)

Matrix 2.0 introduces native OIDC authentication. This is the future of Matrix auth.

```typescript
import { createClient, type OidcTokenRefresher } from "matrix-js-sdk/src/matrix";

// Check if homeserver supports OIDC
const client = createClient({ baseUrl: homeserverUrl });
const authIssuer = await client.getAuthMetadata().catch(() => null);
const supportsOidc = !!authIssuer?.issuer;

// If OIDC: redirect to authorization endpoint (use matrix-auth-client or similar)
// After authorization, you get access_token + refresh_token from the token endpoint

// Create client with OIDC token refresher
class MyOidcTokenRefresher extends OidcTokenRefresher {
  async persistTokens(accessToken: string, refreshToken?: string): Promise<void> {
    // Save tokens securely (encrypted storage)
    await secureStorage.set("accessToken", accessToken);
    if (refreshToken) await secureStorage.set("refreshToken", refreshToken);
  }
}

const tokenRefresher = new MyOidcTokenRefresher(
  issuer,
  clientId,
  redirectUri,
  deviceId,
  idTokenClaims,
);

const client = createClient({
  baseUrl: homeserverUrl,
  userId,
  accessToken,
  deviceId,
  tokenRefreshFunction: tokenRefresher.doRefreshAccessToken.bind(tokenRefresher),
});
```

## Token Storage (Element Web pattern)

Element Web encrypts tokens in localStorage using AES:

```typescript
// Store tokens securely
// In browser: encrypt with a key derived from the session
// In Node: use OS keychain or encrypted file

// Minimal implementation: localStorage with a warning
function persistCredentials(creds: SessionCredentials): void {
  localStorage.setItem("mx_hs_url", creds.homeserverUrl);
  localStorage.setItem("mx_user_id", creds.userId);
  localStorage.setItem("mx_device_id", creds.deviceId);
  // WARNING: storing access tokens in plaintext is insecure
  // Element Web encrypts these with a pickle key stored separately
  localStorage.setItem("mx_access_token", creds.accessToken);
  if (creds.refreshToken) {
    localStorage.setItem("mx_refresh_token", creds.refreshToken);
  }
}

function loadCredentials(): SessionCredentials | null {
  const homeserverUrl = localStorage.getItem("mx_hs_url");
  const userId = localStorage.getItem("mx_user_id");
  const deviceId = localStorage.getItem("mx_device_id");
  const accessToken = localStorage.getItem("mx_access_token");
  if (!homeserverUrl || !userId || !deviceId || !accessToken) return null;
  return {
    homeserverUrl,
    userId,
    deviceId,
    accessToken,
    refreshToken: localStorage.getItem("mx_refresh_token") ?? undefined,
  };
}
```

## Logout

```typescript
async function logout(client: MatrixClient): Promise<void> {
  try {
    await client.logout(true); // true = logout all devices
  } catch (err) {
    console.warn("Logout request failed (may already be invalid):", err);
  } finally {
    client.stopClient();
    await client.store.destroy?.();
    // Clear all persisted credentials
    clearStoredCredentials();
  }
}
```

## Guest Access

```typescript
// Register as a guest (anonymous)
const client = createClient({ baseUrl: homeserverUrl });
const resp = await client.registerGuest({
  initial_device_display_name: "Guest",
});

const guestClient = createClient({
  baseUrl: homeserverUrl,
  userId: resp.user_id,
  accessToken: resp.access_token,
  deviceId: resp.device_id,
});
guestClient.setGuest(true);

// Peek into a public room without joining
await guestClient.peekInRoom(roomId);
```

## Checking Available Login Flows

```typescript
const client = createClient({ baseUrl: homeserverUrl });
const flows = await client.loginFlows();
// flows.flows: Array<{ type: string }>
// Common: "m.login.password", "m.login.sso", "m.login.token"
const supportsPassword = flows.flows.some((f) => f.type === "m.login.password");
const supportsSSO = flows.flows.some((f) => f.type === "m.login.sso");
```
