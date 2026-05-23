/**
 * React Native TDBC driver (react-native-quick-sqlite).
 *
 * @module tdbc-driver-rn
 */

import { registerDriver } from "@novel-master/core";
import { RnDriver } from "./driver.js";

export type { RnSqliteAdapter, QuickSqliteResult } from "./adapter.js";
export { QuickSqliteAdapter } from "./quick-sqlite-adapter.js";
export { RnConnection } from "./connection.js";
export { RnDriver, RN_DRIVER_NAME } from "./driver.js";
export type { RnOpenOptions } from "./driver.js";

/**
 * Registers the RN driver as `rn`.
 */
export function registerRnDriver(adapter?: import("./adapter.js").RnSqliteAdapter): void {
  registerDriver(new RnDriver(adapter));
}
