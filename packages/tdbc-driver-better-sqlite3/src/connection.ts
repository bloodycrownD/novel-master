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

/** Transaction-scoped view: sync ops on parent without re-entering the mutex. */
class TransactionalConnection implements TdbcConnection {
  constructor(private readonly parent: BetterSqlite3Connection) {}

  execute(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<ExecuteResult> {
    return Promise.resolve(this.parent.executeSync(sql, parameters));
  }

  query<T extends Row = Row>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<T[]> {
    return Promise.resolve(this.parent.querySync<T>(sql, parameters));
  }

  batch(
    sql: string,
    parametersList: readonly (readonly unknown[])[],
  ): Promise<BatchResult> {
    return Promise.resolve(this.parent.batchSync(sql, parametersList));
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
