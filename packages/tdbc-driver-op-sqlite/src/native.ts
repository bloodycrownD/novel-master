/**
 * RN / Metro 入口：静态 op-sqlite 绑定（{@link NativeOpSqliteAdapter}）。
 *
 * 与主入口 `.` 是同一包的两种平台入口（本入口静态绑定、主入口动态加载），
 * 属于有意的平台分流而非重复注册；注册实现统一转发 `register.js`。
 *
 * @module tdbc-driver-op-sqlite/native
 */

import { OpSqliteSharedRegister } from "./register.js";
import type { OpSqliteAdapter } from "./adapter.js";
import { NativeOpSqliteAdapter } from "./impl/op-sqlite-native.adapter.js";

export type { OpSqliteAdapter, OpSqliteResult } from "./adapter.js";
export { OPSQLITE_DRIVER_NAME } from "./driver.js";
export { NativeOpSqliteAdapter } from "./impl/op-sqlite-native.adapter.js";

// nm-style 注记：native 入口（静态绑定）的注册口，按成员主体起名（OpSqliteNativeRegister，与动态入口的 OpSqliteRegister 区分）。
/**
 * 注册 op-sqlite 驱动为 `op-sqlite`（默认 adapter：静态 op-sqlite 绑定）。
 *
 * @param adapter - 显式 adapter；缺省用原生静态绑定实现。
 * @param isBackground - 可选后台探测函数（app 层注入）：后台时事务内
 *   跳过休眠量子让步、回前台恢复；未注入行为与现状一致。详见
 *   {@link OpSqliteSharedRegister.registerWith}。
 */
export namespace OpSqliteNativeRegister {
  export function register(
    adapter?: OpSqliteAdapter,
    isBackground?: () => boolean,
  ): void {
    OpSqliteSharedRegister.registerWith(
      adapter ?? new NativeOpSqliteAdapter(),
      isBackground,
    );
  }
}
