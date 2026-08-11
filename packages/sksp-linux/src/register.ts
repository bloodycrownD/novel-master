/**
 * Registers the Linux SKSP driver.
 *
 * @module register
 */

import type { TdbcConnection } from "@novel-master/core/tdbc";
import { registerSkspDriver } from "@novel-master/core/sksp";
import { createLinuxSecretStore } from "./sqlite-secret-store.js";

/** Registers `linux` SKSP driver (Secret Service + AES-GCM + SQLite). */
export function registerSkspLinuxDriver(): void {
  registerSkspDriver({
    name: "linux",
    createStore: (conn) => createLinuxSecretStore(conn as TdbcConnection),
  });
}
