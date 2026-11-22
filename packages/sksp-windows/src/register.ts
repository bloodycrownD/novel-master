/**
 * Registers the Windows SKSP driver.
 *
 * @module register
 */

import type { TdbcConnection } from "@novel-master/core/tdbc";
import { SkspRegistry } from "@novel-master/core/sksp";
import { WindowsSecretStore } from "./sqlite-secret-store.js";

// nm-style 注记：文件名 register 太泛，按成员主体起名（SkspWindowsRegister）。
/** Registers `windows` SKSP driver (DPAPI + SQLite). */
export namespace SkspWindowsRegister {
    export function register(): void {
        SkspRegistry.register({
            name: "windows",
            createStore: (conn) => WindowsSecretStore.create(conn as TdbcConnection),
        });
    }
}
