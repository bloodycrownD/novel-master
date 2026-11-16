/**
 * Transaction fallback shared by repositories and services.
 *
 * @module infra/tdbc/logic/transaction-helper
 */

import { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";
import { TdbcError } from "../errors.js";
import type { TdbcConnection } from "../ports/connection.port.js";

/**
 * 无外层事务时开一个事务跑 `fn`；已经身处事务中则直接复用 `conn` 跑。
 *
 * 边界（务必保留，别"顺手"改成 try/finally 或吞错）：这个兜底**只**针对
 * `conn.transaction()` 入口抛出的 `NESTED_TRANSACTION`——三驱动契约里 tx 句柄的
 * `transaction()` 无条件 reject 且**不执行** `fn`（connection.port.ts:37），
 * 所以捕获后用 `fn(conn)` 直通是等价且安全的。若 `fn` 内部自己抛出同码错误，
 * 会被误判成「已在事务内」而重跑一遍，已执行的写操作将被重放。
 */
export async function runInTransactionOrConn<T>(conn: TdbcConnection, fn: (tx: TdbcConnection) => Promise<T>): Promise<T> {
  try {
    return await conn.transaction(fn);
  } catch (error) {
    if (error instanceof TdbcError && error.code === "NESTED_TRANSACTION") {
      return fn(conn);
    }
    throw error;
  }
}

/**
 * 事务回调内的 `Result` 解包（门⑦白名单形态，总纲 §五例外 2）。
 *
 * better-sqlite3 / tdbc 的事务只认抛错回滚，事务回调内的已知失败必须
 * 升级为 throw 才能保住原子性（返回值会被事务包装层无视，留下半写状态）；
 * 解包字面集中在此处，调用方零 `throw x.error`。外层 catch 按 TdbcError
 * cause 解包还原业务错误码（既有链路不变）。
 */
export function unwrapOrRollback<T>(r: Result<T, AppError>): T {
  if (!r.ok) {
    throw r.error;
  }
  return r.value;
}
