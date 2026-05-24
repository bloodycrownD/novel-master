/**
 * Registers the Android SKSP driver.
 *
 * @module register
 */

import type { TdbcConnection } from "@novel-master/core/tdbc";
import { registerSkspDriver } from "@novel-master/core/sksp";
import { createAndroidSecretStore } from "./android-secret-store.js";

/** Registers `android` SKSP driver (Keystore + SQLite). */
export function registerSkspAndroidDriver(): void {
  registerSkspDriver({
    name: "android",
    createStore: (conn) => createAndroidSecretStore(conn as TdbcConnection),
  });
}
