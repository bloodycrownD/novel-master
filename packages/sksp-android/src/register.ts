/**
 * Registers the Android SKSP driver.
 *
 * @module register
 */

import type { TdbcConnection } from "@novel-master/core/tdbc";
import { SkspRegistry } from "@novel-master/core/sksp";
import { AndroidSecretStoreFactory } from "./android-secret-store.js";

// nm-style 注记：文件名 register 太泛，按成员主体起名（SkspAndroidRegister）。
/** Registers `android` SKSP driver (Keystore + SQLite). */
export namespace SkspAndroidRegister {
    export function register(): void {
        SkspRegistry.register({
            name: "android",
            createStore: (conn) => AndroidSecretStoreFactory.create(conn as TdbcConnection),
        });
    }
}
