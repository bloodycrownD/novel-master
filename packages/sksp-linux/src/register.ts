/**
 * Registers the Linux SKSP driver.
 *
 * @module register
 */

import type { TdbcConnection } from "@novel-master/core/tdbc";
import { SkspRegistry } from "@novel-master/core/sksp";
import { LinuxSecretStore } from "./sqlite-secret-store.js";

// nm-style 注记：文件名 register 太泛，按成员主体起名（SkspLinuxRegister）。
/** Registers `linux` SKSP driver (Secret Service + AES-GCM + SQLite). */
export namespace SkspLinuxRegister {
  export function register(): void {
    SkspRegistry.register({
      name: "linux",
      createStore: (conn) => LinuxSecretStore.create(conn as TdbcConnection),
    });
  }
}
