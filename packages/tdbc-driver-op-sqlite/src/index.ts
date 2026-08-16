/**
 * op-sqlite TDBC 驱动（@op-engineering/op-sqlite，动态加载入口）。
 *
 * @module tdbc-driver-op-sqlite
 */

import { registerDriver } from "@novel-master/core";
import { OpSqliteDriver } from "./driver.js";
import { OpSqliteDynamicAdapter } from "./impl/op-sqlite-dynamic.adapter.js";

export type { OpSqliteAdapter, OpSqliteResult } from "./adapter.js";
export { OpSqliteDynamicAdapter } from "./impl/op-sqlite-dynamic.adapter.js";
export { OpSqliteConnection } from "./connection.js";
export { OpSqliteDriver, OPSQLITE_DRIVER_NAME } from "./driver.js";
export type { OpSqliteOpenOptions } from "./driver.js";

/**
 * 注册 op-sqlite 驱动为 `op-sqlite`（默认 adapter：动态加载 op-sqlite）。
 */
export function registerOpSqliteDriver(adapter?: import("./adapter.js").OpSqliteAdapter): void {
  registerDriver(new OpSqliteDriver(adapter ?? new OpSqliteDynamicAdapter()));
}
