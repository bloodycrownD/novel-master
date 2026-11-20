/**
 * Node.js TDBC driver for better-sqlite3.
 *
 * @module tdbc-driver-better-sqlite3
 */

import { TdbcRegistry } from "@novel-master/core";
import { BetterSqlite3Driver } from "./driver.js";

export { BetterSqlite3Connection } from "./connection.js";
export {
  BetterSqlite3Driver,
  BETTER_SQLITE3_DRIVER_NAME,
} from "./driver.js";

// nm-style 注记：barrel 主入口的注册口，按成员主体起名（BetterSqlite3Register）。
/**
 * Registers the better-sqlite3 driver as `better-sqlite3`.
 */
export namespace BetterSqlite3Register {
  export function register(): void {
    TdbcRegistry.register(new BetterSqlite3Driver());
  }
}
