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
import { TdbcError, normalizeBindings } from "@novel-master/core";
import type { RnSqliteAdapter } from "./adapter.js";
import { AsyncMutex } from "./mutex.js";
import { rowsFromResult } from "./row-mapper.js";

export class RnConnection implements TdbcConnection {
  private closed = false;
  private inTransaction = false;
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
      const txConn = new TransactionalConnection(this);

      // --- transaction boundary: BEGIN / COMMIT / ROLLBACK via adapter ---
      await this.adapter.execute("BEGIN");
      try {
        const value = await fn(txConn);
        await this.adapter.execute("COMMIT");
        return value;
      } catch (cause) {
        await this.adapter.execute("ROLLBACK");
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
      const result = await this.adapter.execute(
        sql,
        normalizeBindings(parameters),
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
      const result = await this.adapter.execute(
        sql,
        normalizeBindings(parameters),
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

    await this.adapter.execute("BEGIN");
    let totalChanges = 0;
    try {
      for (const params of parametersList) {
        const result = await this.adapter.execute(
          sql,
          normalizeBindings(params),
        );
        totalChanges += result.rowsAffected ?? 0;
      }
      await this.adapter.execute("COMMIT");
      return { totalChanges, count: parametersList.length };
    } catch (cause) {
      await this.adapter.execute("ROLLBACK");
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
