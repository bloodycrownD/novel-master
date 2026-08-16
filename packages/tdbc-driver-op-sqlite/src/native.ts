/**
 * RN / Metro 入口：静态 op-sqlite 绑定（{@link NativeOpSqliteAdapter}）。
 *
 * @module tdbc-driver-op-sqlite/native
 */

import { registerDriver } from "@novel-master/core";
import type { OpSqliteAdapter } from "./adapter.js";
import { OpSqliteDriver } from "./driver.js";
import { NativeOpSqliteAdapter } from "./impl/op-sqlite-native.adapter.js";

export type { OpSqliteAdapter, OpSqliteResult } from "./adapter.js";
export { OPSQLITE_DRIVER_NAME } from "./driver.js";
export { NativeOpSqliteAdapter } from "./impl/op-sqlite-native.adapter.js";

/**
 * 注册 op-sqlite 驱动为 `op-sqlite`（默认 adapter：静态 op-sqlite 绑定）。
 */
export function registerOpSqliteDriver(adapter?: OpSqliteAdapter): void {
  registerDriver(new OpSqliteDriver(adapter ?? new NativeOpSqliteAdapter()));
}
