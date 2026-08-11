# @novel-master/sksp-linux

Linux SKSP driver：应用 master key 存在 Secret Service（GNOME Keyring / KWallet），AES-256-GCM 密文落在 `sksp_secrets`。

## Usage

```typescript
import { registerSkspLinuxDriver } from "@novel-master/sksp-linux";
import { resolveSkspDriver } from "@novel-master/core/sksp";

registerSkspLinuxDriver();
const driver = resolveSkspDriver("linux");
const store = driver.createStore(conn);
await store.set("provider/foo/apiKey", "secret-value");
```

Secret Service entry：service `novel-master-linux`，account `sksp-master-v1`（32 字节 master key，base64 编码）。

算法：`linux-secret-service-aes-gcm-v1`，每次 `set` 用随机 12 字节 IV。

## 运行时依赖

`@napi-rs/keyring` 在 Linux 上走 Secret Service（D-Bus），需要一个可用的守护进程：

- 桌面环境（GNOME / KDE）通常自带 GNOME Keyring 或 KWallet，开箱即用。
- 无头环境（CI、服务器）需要手动装 `gnome-keyring` 并用 `dbus-run-session` 启动一个会话，否则 `set`/`get` 会抛 `ENCRYPT_FAILED` / `DECRYPT_FAILED`。

## Tests (CI / 非 Linux)

单测通过 passthrough 绕过 Secret Service：

```typescript
import { setLinuxKeychainTestPassthrough } from "@novel-master/sksp-linux";

setLinuxKeychainTestPassthrough(true);
// ... run store tests ...
setLinuxKeychainTestPassthrough(false);
```
