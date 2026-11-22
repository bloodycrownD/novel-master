/**
 * Registers the macOS SKSP driver.
 *
 * @module register
 */

import type { TdbcConnection } from "@novel-master/core/tdbc";
import { SkspRegistry } from "@novel-master/core/sksp";
import { MacSecretStore } from "./sqlite-secret-store.js";

// nm-style 注记：文件名 register 太泛，按成员主体起名（SkspMacRegister）。
/** Registers `macos` SKSP driver (Keychain + AES-GCM + SQLite). */
export namespace SkspMacRegister {
    export function register(): void {
        SkspRegistry.register({
            name: "macos",
            createStore: (conn) => MacSecretStore.create(conn as TdbcConnection),
        });
    }
}
