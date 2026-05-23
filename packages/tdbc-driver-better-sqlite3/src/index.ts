/**
 * Node.js TDBC driver for better-sqlite3.
 *
 * @module tdbc-driver-better-sqlite3
 */

import { registerDriver } from "@novel-master/core";
import { BetterSqlite3Driver } from "./driver.js";

export { BetterSqlite3Connection } from "./connection.js";
export {
  BetterSqlite3Driver,
  BETTER_SQLITE3_DRIVER_NAME,
} from "./driver.js";
export { AsyncMutex } from "./mutex.js";

/**
 * Registers the better-sqlite3 driver as `better-sqlite3`.
 */
export function registerBetterSqlite3Driver(): void {
  registerDriver(new BetterSqlite3Driver());
}
