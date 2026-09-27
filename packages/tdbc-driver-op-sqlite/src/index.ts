/**
 * op-sqlite TDBC 驱动（@op-engineering/op-sqlite，动态加载入口）。
 *
 * @module tdbc-driver-op-sqlite
 */

import { OpSqliteDynamicAdapter } from "./impl/op-sqlite-dynamic.adapter.js";
import { registerOpSqliteDriverWith } from "./register.js";

export type { OpSqliteAdapter, OpSqliteResult } from "./adapter.js";
export { OpSqliteDynamicAdapter } from "./impl/op-sqlite-dynamic.adapter.js";
export { OpSqliteConnection } from "./connection.js";
export { OpSqliteDriver, OPSQLITE_DRIVER_NAME } from "./driver.js";
export type { OpSqliteOpenOptions } from "./driver.js";

/**
 * 注册 op-sqlite 驱动为 `op-sqlite`（默认 adapter：动态加载 op-sqlite）。
 *
 * @param adapter - 显式 adapter；缺省用动态加载实现。
 * @param isBackground - 可选后台探测函数（app 层注入）：后台时事务内
 *   跳过休眠量子让步、回前台恢复；未注入行为与现状一致。详见
 *   {@link registerOpSqliteDriverWith}。
 */
export function registerOpSqliteDriver(
  adapter?: import("./adapter.js").OpSqliteAdapter,
  isBackground?: () => boolean,
): void {
  registerOpSqliteDriverWith(
    adapter ?? new OpSqliteDynamicAdapter(),
    isBackground,
  );
}
