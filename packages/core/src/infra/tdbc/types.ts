/**
 * TDBC value and result types shared by protocol and drivers.
 *
 * @module infra/tdbc/types
 */

/** SQLite column values as represented in JavaScript. */
export type SqlValue = null | number | string | bigint | Uint8Array;

/** A single result row keyed by column name. */
export type Row = Record<string, SqlValue>;

/** Result metadata from a write or generic execute. */
export interface ExecuteResult {
  /** sqlite3_changes() */
  changes: number;
  /** sqlite3_last_insert_rowid(); 0 when no row was inserted. */
  lastInsertRowid: number | bigint;
}

/** Aggregated outcome of a {@link TdbcConnection.batch} call. */
export interface BatchResult {
  /** Sum of changes across all parameter sets. */
  totalChanges: number;
  /** Number of parameter sets executed. */
  count: number;
}

/** Options for {@link open} and driver-specific open hooks. */
export interface OpenOptions {
  /** Overrides the path from the URL (e.g. `:memory:`). */
  filename?: string;
  /** Open the database read-only. */
  readOnly?: boolean;
  /** Explicit driver name; takes precedence over URL-based inference. */
  driver?: string;
}
