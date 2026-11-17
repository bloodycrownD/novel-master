/**
 * op-sqlite TDBC 驱动（@op-engineering/op-sqlite，动态加载入口）。
 *
 * 与 `./native` 是**同一包的两种平台入口**（本入口动态加载、native 静态绑定），
 * 属于有意的平台分流而非重复注册：包 exports 把二者挂在不同子路径，应用只按
 * 运行环境选用其中一个；两个入口的注册实现统一转发 `register.js`，不会产生
 * 两份驱动逻辑。app 层调用纪律见 `apps/mobile/src/db/connection.ts`（last-wins，
 * 全 app 只经单一入口注册）。
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
