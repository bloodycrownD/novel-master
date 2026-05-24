/**
 * RN SQLite adapter contract (isolates react-native-quick-sqlite).
 *
 * @module tdbc-driver-rn/adapter
 */

/** Subset of react-native-quick-sqlite execute result. */
export type QuickSqliteRows =
  | (Record<string, unknown> | unknown[])[]
  | {
      readonly _array: (Record<string, unknown> | unknown[])[];
      readonly length: number;
      item?: (idx: number) => unknown;
    };

export interface QuickSqliteResult {
  rows?: QuickSqliteRows;
  rowsAffected?: number;
  insertId?: number;
  columnNames?: string[];
  metadata?: { columnName: string }[];
}

/**
 * Pluggable async SQLite backend for the RN driver.
 */
export interface RnSqliteAdapter {
  open(options: { name: string; location?: string }): Promise<void>;
  close(): Promise<void>;
  execute(sql: string, params?: unknown[]): Promise<QuickSqliteResult>;
}
