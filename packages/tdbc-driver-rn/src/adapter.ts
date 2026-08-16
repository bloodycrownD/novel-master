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
  /**
   * 同步 execute（可选能力，目前仅 quick-sqlite 系 adapter 提供）。
   *
   * 用途：RnConnection 在 BEGIN...COMMIT 事务内切换到同步调用——
   * quick-sqlite 的 async execute 走 JSI 异步调度，在长事务内大量语句时
   * 有 native 层缺陷（真机实测：无参大语句 promise 永远挂起、带参语句报
   * disk I/O error），官方建议事务内用同步 API。
   */
  executeSync?(sql: string, params?: unknown[]): QuickSqliteResult;
}
