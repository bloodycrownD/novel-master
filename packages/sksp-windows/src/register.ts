/**
 * Registers the Windows SKSP driver.
 *
 * @module register
 */

import type { TdbcConnection } from "@novel-master/core/tdbc";
import { registerSkspDriver } from "@novel-master/core/sksp";
import { createWindowsSecretStore } from "./sqlite-secret-store.js";

/** Registers `windows` SKSP driver (DPAPI + SQLite). */
export function registerSkspWindowsDriver(): void {
  registerSkspDriver({
    name: "windows",
    createStore: (conn) => createWindowsSecretStore(conn as TdbcConnection),
  });
}
