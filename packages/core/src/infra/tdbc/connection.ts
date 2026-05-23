/**
 * TDBC connection contract: async execute, query, batch, and transaction.
 *
 * @module infra/tdbc/connection
 */

import type { BatchResult, ExecuteResult, Row } from "./types.js";

/**
 * Async database connection. Implementations must reject with
 * {@link TdbcError} `CONNECTION_CLOSED` after {@link close}.
 */
export interface TdbcConnection {
  /**
   * Runs a statement that does not return rows (INSERT, UPDATE, DELETE, DDL).
   */
  execute(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<ExecuteResult>;

  /**
   * Runs a SELECT (or similar) and returns all rows.
   */
  query<T extends Row = Row>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<T[]>;

  /**
   * Executes the same SQL for each parameter set inside one transaction.
   * Any failure rolls back the entire batch.
   */
  batch(
    sql: string,
    parametersList: readonly (readonly unknown[])[],
  ): Promise<BatchResult>;

  /**
   * Runs `fn` inside a transaction. Nested calls throw `NESTED_TRANSACTION`.
   */
  transaction<T>(fn: (tx: TdbcConnection) => Promise<T>): Promise<T>;

  /** Idempotent close; further operations throw `CONNECTION_CLOSED`. */
  close(): Promise<void>;
}
