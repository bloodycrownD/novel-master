/**
 * RN / Metro 入口：静态 op-sqlite 绑定（{@link NativeOpSqliteAdapter}）。
 *
 * 与主入口 `.` 是同一包的两种平台入口（本入口静态绑定、主入口动态加载），
 * 属于有意的平台分流而非重复注册；注册实现统一转发 `register.js`。
 *
 * @module tdbc-driver-op-sqlite/native
 */

import { registerOpSqliteDriverWith } from "./register.js";
import type { OpSqliteAdapter } from "./adapter.js";
import { NativeOpSqliteAdapter } from "./impl/op-sqlite-native.adapter.js";

export type { OpSqliteAdapter, OpSqliteResult } from "./adapter.js";
export { OPSQLITE_DRIVER_NAME } from "./driver.js";
export { NativeOpSqliteAdapter } from "./impl/op-sqlite-native.adapter.js";

/**
 * 注册 op-sqlite 驱动为 `op-sqlite`（默认 adapter：静态 op-sqlite 绑定）。
 *
 * @param adapter - 显式 adapter；缺省用原生静态绑定实现。
 * @param isBackground - 可选后台探测函数（app 层注入）：后台时事务内
 *   跳过休眠量子让步、回前台恢复；未注入行为与现状一致。详见
 *   {@link registerOpSqliteDriverWith}。
 */
export function registerOpSqliteDriver(
  adapter?: OpSqliteAdapter,
  isBackground?: () => boolean,
): void {
  registerOpSqliteDriverWith(
    adapter ?? new NativeOpSqliteAdapter(),
    isBackground,
  );
}
