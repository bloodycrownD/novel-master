/**
 * RN / Metro entry: static quick-sqlite binding via {@link NativeQuickSqliteAdapter}.
 *
 * @module tdbc-driver-rn/native
 */

import { registerDriver } from "@novel-master/core";
import type { RnSqliteAdapter } from "./adapter.js";
import { RnDriver } from "./driver.js";
import { NativeQuickSqliteAdapter } from "./impl/quick-sqlite-native.adapter.js";

export type { RnSqliteAdapter, QuickSqliteResult } from "./adapter.js";
export { RN_DRIVER_NAME } from "./driver.js";
export { NativeQuickSqliteAdapter } from "./impl/quick-sqlite-native.adapter.js";

/**
 * Registers the RN driver as `rn` (default adapter: static quick-sqlite).
 */
export function registerRnDriver(adapter?: RnSqliteAdapter): void {
  registerDriver(new RnDriver(adapter ?? new NativeQuickSqliteAdapter()));
}
