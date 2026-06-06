/**
 * Registers the macOS SKSP driver.
 *
 * @module register
 */

import type { TdbcConnection } from "@novel-master/core/tdbc";
import { registerSkspDriver } from "@novel-master/core/sksp";
import { createMacSecretStore } from "./sqlite-secret-store.js";

/** Registers `macos` SKSP driver (Keychain + AES-GCM + SQLite). */
export function registerSkspMacDriver(): void {
  registerSkspDriver({
    name: "macos",
    createStore: (conn) => createMacSecretStore(conn as TdbcConnection),
  });
}
