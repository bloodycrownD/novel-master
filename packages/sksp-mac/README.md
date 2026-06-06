# @novel-master/sksp-mac

macOS SKSP driver: application master key in Login Keychain, AES-256-GCM ciphertext in `sksp_secrets`.

## Usage

```typescript
import { registerSkspMacDriver } from "@novel-master/sksp-mac";
import { resolveSkspDriver } from "@novel-master/core/sksp";

registerSkspMacDriver();
const driver = resolveSkspDriver("macos");
const store = driver.createStore(conn);
await store.set("provider/foo/apiKey", "secret-value");
```

Keychain entry: service `novel-master`, account `sksp-master-v1` (32-byte master key, base64-encoded).

Algorithm: `macos-keychain-aes-gcm-v1` with a random 12-byte IV per `set`.

## Tests (CI / non-macOS)

Unit tests bypass Keychain via passthrough:

```typescript
import { setMacKeychainTestPassthrough } from "@novel-master/sksp-mac";

setMacKeychainTestPassthrough(true);
// ... run store tests ...
setMacKeychainTestPassthrough(false);
```

## Manual verification (macOS)

With passthrough disabled, `set` → `get` round-trip uses the real Keychain. Confirm Keychain Access shows a generic password for `novel-master` / `sksp-master-v1`.
