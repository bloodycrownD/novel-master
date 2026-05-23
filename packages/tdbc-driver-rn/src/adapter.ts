/**
 * RN SQLite adapter contract (isolates react-native-quick-sqlite).
 *
 * @module tdbc-driver-rn/adapter
 */

/** Subset of react-native-quick-sqlite execute result. */
export interface QuickSqliteResult {
  rows?: (Record<string, unknown> | unknown[])[];
  rowsAffected?: number;
  insertId?: number;
  columnNames?: string[];
}

/**
 * Pluggable async SQLite backend for the RN driver.
 */
export interface RnSqliteAdapter {
  open(options: { name: string; location?: string }): Promise<void>;
  close(): Promise<void>;
  execute(sql: string, params?: unknown[]): Promise<QuickSqliteResult>;
}
