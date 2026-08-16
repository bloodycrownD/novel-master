/**
 * RN TDBC connection: async adapter behind the protocol surface.
 *
 * @module tdbc-driver-rn/connection
 */

import type {
  BatchResult,
  ExecuteResult,
  Row,
  TdbcConnection,
} from "@novel-master/core";
import { TdbcError } from "@novel-master/core";
import type { RnSqliteAdapter } from "./adapter.js";
import { normalizeQuickSqliteBindings } from "./bindings.js";
import { AsyncMutex } from "./mutex.js";
import { rowsFromResult } from "./row-mapper.js";

export class RnConnection implements TdbcConnection {
  private closed = false;
  private inTransaction = false;
  /** Nesting depth for SAVEPOINT naming inside an outer transaction. */
  private savepointDepth = 0;
  /** 上次让出事件循环的时间戳（事务内按时间量子让步，而非逐语句）。 */
  private lastYieldAt = 0;
  private readonly mutex = new AsyncMutex();

  constructor(private readonly adapter: RnSqliteAdapter) {}

  execute(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<ExecuteResult> {
    return this.mutex.run(() => this.executeDirect(sql, parameters));
  }

  query<T extends Row = Row>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<T[]> {
    return this.mutex.run(() => this.queryDirect<T>(sql, parameters));
  }

  batch(
    sql: string,
    parametersList: readonly (readonly unknown[])[],
  ): Promise<BatchResult> {
    return this.mutex.run(() => this.batchDirect(sql, parametersList));
  }

  transaction<T>(fn: (tx: TdbcConnection) => Promise<T>): Promise<T> {
    return this.mutex.run(async () => {
      this.assertOpen();
      if (this.inTransaction) {
        throw new TdbcError(
          "NESTED_TRANSACTION",
          "Nested transactions are not supported",
          { driver: "rn" },
        );
      }

      this.inTransaction = true;
      this.lastYieldAt = Date.now();
      const txConn = new TransactionalConnection(this);

      // --- transaction boundary: BEGIN / COMMIT / ROLLBACK via runAdapter ---
      // 事务内语句一律同步 executeSync（runAdapter 按标志分流）：真机实测
      // quick-sqlite 的 async execute 在事务内执行中大体积写语句（分块
      // INSERT...SELECT、CREATE INDEX、DDL）会稳定报 disk I/O error 或 SIGSEGV
      // （后台线程与 JS 线程并发使用同一连接所致）；同步 JSI 全程单线程，无此问题。
      // ANR 风险由 runAdapter 的逐语句让出事件循环兑冲（历史上触发 ANR 的是
      // 逐行小语句的 3 万次往返，不是单条毫秒级的引擎内搬运）。
      await this.runAdapter("BEGIN", undefined);
      try {
        const value = await fn(txConn);
        await this.runAdapter("COMMIT", undefined);
        return value;
      } catch (cause) {
        // ROLLBACK 失败不能掩盖原始错误：某些 SQLite 错误会自动中断事务
        // （此时 ROLLBACK 报 "no transaction is active"），吞掉它只打日志，
        // 原始错误照常抛出，否则用户只看到回滚失败而真正的病因被吞。
        try {
          await this.runAdapter("ROLLBACK", undefined);
        } catch (rollbackError) {
          console.warn(
            "[rn-tdbc] ROLLBACK 失败（事务可能已被自动中断）:",
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError),
          );
        }
        if (cause instanceof TdbcError) {
          throw cause;
        }
        throw this.wrapSqlite(cause);
      } finally {
        this.inTransaction = false;
      }
    });
  }

  close(): Promise<void> {
    return this.mutex.run(async () => {
      if (!this.closed) {
        this.closed = true;
        await this.adapter.close();
      }
    });
  }

  /** @internal Direct query without mutex re-entry. */
  async queryDirect<T extends Row = Row>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<T[]> {
    this.assertOpen();
    try {
      const result = await this.runAdapter(
        sql,
        normalizeQuickSqliteBindings(parameters),
      );
      return rowsFromResult(result) as T[];
    } catch (cause) {
      throw this.wrapSqlite(cause);
    }
  }

  /** @internal Direct execute for transactional delegate. */
  async executeDirect(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<ExecuteResult> {
    this.assertOpen();
    try {
      const result = await this.runAdapter(
        sql,
        normalizeQuickSqliteBindings(parameters),
      );
      return {
        changes: result.rowsAffected ?? 0,
        lastInsertRowid: result.insertId ?? 0,
      };
    } catch (cause) {
      throw this.wrapSqlite(cause);
    }
  }

  /** @internal Direct batch for transactional delegate. */
  async batchDirect(
    sql: string,
    parametersList: readonly (readonly unknown[])[],
  ): Promise<BatchResult> {
    this.assertOpen();
    if (parametersList.length === 0) {
      return { totalChanges: 0, count: 0 };
    }

    const runStatements = async (): Promise<BatchResult> => {
      let totalChanges = 0;
      for (const params of parametersList) {
        const result = await this.runAdapter(
          sql,
          normalizeQuickSqliteBindings(params),
        );
        totalChanges += result.rowsAffected ?? 0;
      }
      return { totalChanges, count: parametersList.length };
    };

    if (this.inTransaction) {
      // --- batch inside outer transaction: SAVEPOINT-scoped nested transaction.
      // A failure rolls back only this batch (ROLLBACK TO sp); the outer
      // transaction stays open and usable, matching better-sqlite3's
      // db.transaction() nesting semantics. ---
      const sp = `tdbc_sp_${++this.savepointDepth}`;
      await this.runAdapter(`SAVEPOINT ${sp}`, undefined);
      try {
        const result = await runStatements();
        await this.runAdapter(`RELEASE ${sp}`, undefined);
        return result;
      } catch (cause) {
        // Roll back to the savepoint and drop it before surfacing the
        // error, so the outer transaction is left in a clean state.
        // 回滚失败不能掩盖原始错误（事务可能已被自动中断），只打日志。
        try {
          await this.runAdapter(`ROLLBACK TO ${sp}`, undefined);
          await this.runAdapter(`RELEASE ${sp}`, undefined);
        } catch (rollbackError) {
          console.warn(
            "[rn-tdbc] SAVEPOINT 回滚失败（事务可能已被自动中断）:",
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError),
          );
        }
        throw new TdbcError("BATCH_FAILED", "Batch execution failed", {
          driver: "rn",
          cause,
        });
      } finally {
        this.savepointDepth--;
      }
    }

    // --- batch boundary: standalone transaction via adapter ---
    await this.runAdapter("BEGIN", undefined);
    try {
      const result = await runStatements();
      await this.runAdapter("COMMIT", undefined);
      return result;
    } catch (cause) {
      // 回滚失败不能掩盖原始错误（事务可能已被自动中断），只打日志。
      try {
        await this.runAdapter("ROLLBACK", undefined);
      } catch (rollbackError) {
        console.warn(
          "[rn-tdbc] batch ROLLBACK 失败（事务可能已被自动中断）:",
          rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError),
        );
      }
      throw new TdbcError("BATCH_FAILED", "Batch execution failed", {
        driver: "rn",
        cause,
      });
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new TdbcError("CONNECTION_CLOSED", "Connection is closed", {
        driver: "rn",
      });
    }
  }

  /**
   * 语句执行分流：事务内（inTransaction）用同步 executeSync，事务外保持
   * async execute。原因：quick-sqlite 的 async execute 在后台线程与 JS 线程
   * 并发使用同一连接，事务内连续中大体积语句时真机稳定复现 disk I/O error
   * / SIGSEGV；同步 JSI 单线程执行无此缺陷，单条语句（分块搬运 ≤100 行）
   * 毫秒级，不会长期霸占 JS 线程。adapter 无 executeSync 能力时（如测试
   * mock）落回 async，行为与旧版一致。
   */
  private async runAdapter(
    sql: string,
    params: readonly unknown[] | undefined,
  ): Promise<import("./adapter.js").QuickSqliteResult> {
    if (this.inTransaction && this.adapter.executeSync) {
      const result = this.adapter.executeSync(
        sql,
        params as unknown[] | undefined,
      );
      // 按时间量子让出事件循环（16ms）：防 ANR 只需事件循环不被长期剥夺，
      // 逐语句 setTimeout(0) 会让大批量小语句（会话复制 2 万条）每条都付
      // 一次定时器往返；量子化后让步次数从 O(语句数) 降到 O(总时长/16ms)，
      // ANR 防护等价、开销摊薄到可忽略（与 op-sqlite 驱动同款修复）。
      const now = Date.now();
      if (now - this.lastYieldAt >= 16) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        this.lastYieldAt = Date.now();
      }
      return result;
    }
    return this.adapter.execute(sql, params as unknown[] | undefined);
  }

  private wrapSqlite(cause: unknown): TdbcError {
    return new TdbcError(
      "SQLITE_ERROR",
      cause instanceof Error ? cause.message : String(cause),
      { driver: "rn", cause },
    );
  }
}

class TransactionalConnection implements TdbcConnection {
  constructor(private readonly parent: RnConnection) {}

  execute(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<ExecuteResult> {
    return this.parent.executeDirect(sql, parameters);
  }

  query<T extends Row = Row>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<T[]> {
    return this.parent.queryDirect<T>(sql, parameters);
  }

  batch(
    sql: string,
    parametersList: readonly (readonly unknown[])[],
  ): Promise<BatchResult> {
    return this.parent.batchDirect(sql, parametersList);
  }

  transaction<T>(_fn: (tx: TdbcConnection) => Promise<T>): Promise<T> {
    return Promise.reject(
      new TdbcError(
        "NESTED_TRANSACTION",
        "Nested transactions are not supported",
        { driver: "rn" },
      ),
    );
  }

  close(): Promise<void> {
    return this.parent.close();
  }
}
