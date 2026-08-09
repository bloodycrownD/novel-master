/**
 * better-sqlite3 TDBC connection: mutex-serialized sync API behind Promises.
 *
 * @module tdbc-driver-better-sqlite3/connection
 */

import Database from "better-sqlite3";
import type {
  BatchResult,
  ExecuteResult,
  Row,
  TdbcConnection,
} from "@novel-master/core";
import { TdbcError, normalizeBindings } from "@novel-master/core";
import { AsyncMutex } from "./mutex.js";
import { mapRow } from "./row-mapper.js";

export class BetterSqlite3Connection implements TdbcConnection {
  private closed = false;
  private inTransaction = false;
  private readonly mutex = new AsyncMutex();

  constructor(private readonly db: Database.Database) {}

  execute(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<ExecuteResult> {
    return this.mutex.run(() => this.executeSync(sql, parameters));
  }

  query<T extends Row = Row>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<T[]> {
    return this.mutex.run(() => this.querySync<T>(sql, parameters));
  }

  batch(
    sql: string,
    parametersList: readonly (readonly unknown[])[],
  ): Promise<BatchResult> {
    return this.mutex.run(() => this.batchSync(sql, parametersList));
  }

  transaction<T>(fn: (tx: TdbcConnection) => Promise<T>): Promise<T> {
    return this.mutex.run(async () => {
      this.assertOpen();
      if (this.inTransaction) {
        throw new TdbcError(
          "NESTED_TRANSACTION",
          "Nested transactions are not supported",
          { driver: "better-sqlite3" },
        );
      }

      this.inTransaction = true;
      const txConn = new TransactionalConnection(this);

      // --- transaction boundary: explicit BEGIN / COMMIT / ROLLBACK ---
      this.db.exec("BEGIN");
      try {
        const value = await fn(txConn);
        this.db.exec("COMMIT");
        return value;
      } catch (cause) {
        this.db.exec("ROLLBACK");
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
    return this.mutex.run(() => {
      if (!this.closed) {
        this.closed = true;
        this.db.close();
      }
    });
  }

  /** Runs execute without mutex (caller holds the lock or is on tx surface). */
  executeSync(
    sql: string,
    parameters?: readonly unknown[],
  ): ExecuteResult {
    this.assertOpen();
    try {
      const stmt = this.db.prepare(sql);
      const result = stmt.run(...(normalizeBindings(parameters) ?? []));
      return {
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid,
      };
    } catch (cause) {
      throw this.wrapSqlite(cause);
    }
  }

  querySync<T extends Row = Row>(
    sql: string,
    parameters?: readonly unknown[],
  ): T[] {
    this.assertOpen();
    try {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...(normalizeBindings(parameters) ?? [])) as Record<
        string,
        unknown
      >[];
      return rows.map((r) => mapRow(r) as T);
    } catch (cause) {
      throw this.wrapSqlite(cause);
    }
  }

  batchSync(
    sql: string,
    parametersList: readonly (readonly unknown[])[],
  ): BatchResult {
    this.assertOpen();
    if (parametersList.length === 0) {
      return { totalChanges: 0, count: 0 };
    }

    const stmt = this.db.prepare(sql);
    let totalChanges = 0;

    // --- batch boundary: single SQLite transaction, all-or-nothing ---
    const runBatch = this.db.transaction(() => {
      for (const params of parametersList) {
        const result = stmt.run(...(normalizeBindings(params) ?? []));
        totalChanges += result.changes;
      }
    });

    try {
      runBatch();
      return { totalChanges, count: parametersList.length };
    } catch (cause) {
      throw new TdbcError("BATCH_FAILED", "Batch execution failed", {
        driver: "better-sqlite3",
        cause,
      });
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new TdbcError("CONNECTION_CLOSED", "Connection is closed", {
        driver: "better-sqlite3",
      });
    }
  }

  private wrapSqlite(cause: unknown): TdbcError {
    return new TdbcError(
      "SQLITE_ERROR",
      cause instanceof Error ? cause.message : String(cause),
      { driver: "better-sqlite3", cause },
    );
  }
}

/**
 * Transaction-scoped view: sync ops on parent without re-entering the mutex.
 *
 * 方法全部走 async，是为了把 sync 层（executeSync/batchSync）抛出的错误
 * 稳稳包成 rejected Promise。如果用 `Promise.resolve(syncCall())`，一旦
 * syncCall 同步抛错（比如 batch 里的约束冲突），错误会在 Promise 包装
 * 之前直接同步逃逸，调用方拿到的不是 rejected Promise 而是一个同步异常——
 * 这会破坏 TdbcConnection 的 Promise 契约，也会让 assert.rejects 之类的
 * 断言误判。套上 async 后，无论 sync 层怎么抛，对调用方来说都是 rejection。
 */
class TransactionalConnection implements TdbcConnection {
  constructor(private readonly parent: BetterSqlite3Connection) {}

  async execute(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<ExecuteResult> {
    return this.parent.executeSync(sql, parameters);
  }

  async query<T extends Row = Row>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<T[]> {
    return this.parent.querySync<T>(sql, parameters);
  }

  async batch(
    sql: string,
    parametersList: readonly (readonly unknown[])[],
  ): Promise<BatchResult> {
    return this.parent.batchSync(sql, parametersList);
  }

  transaction<T>(_fn: (tx: TdbcConnection) => Promise<T>): Promise<T> {
    return Promise.reject(
      new TdbcError(
        "NESTED_TRANSACTION",
        "Nested transactions are not supported",
        { driver: "better-sqlite3" },
      ),
    );
  }

  close(): Promise<void> {
    return this.parent.close();
  }
}
