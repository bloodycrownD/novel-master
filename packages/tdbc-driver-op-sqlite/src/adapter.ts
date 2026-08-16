/**
 * op-sqlite 适配器契约（隔离 @op-engineering/op-sqlite）。
 *
 * @module tdbc-driver-op-sqlite/adapter
 */

/** op-sqlite execute 结果的子集（rows 为纯数组；保留旧 `_array` 形态兼容 mock）。 */
export type OpSqliteRows =
  | (Record<string, unknown> | unknown[])[]
  | {
      readonly _array: (Record<string, unknown> | unknown[])[];
      readonly length: number;
      item?: (idx: number) => unknown;
    };

export interface OpSqliteResult {
  rows?: OpSqliteRows;
  rowsAffected?: number;
  insertId?: number;
  columnNames?: string[];
  metadata?: { columnName: string }[];
}

/**
 * 可插拔的异步 SQLite 后端（op-sqlite 驱动用）。
 */
export interface OpSqliteAdapter {
  /**
   * 打开数据库。location 支持绝对路径目录（op-sqlite 语义：最终文件为
   * `<location>/<name>`，不改写文件名、不加扩展名，已从原生源码核实）；
   * `failOnCreate: true` 时文件不存在则直接失败而非新建空库，用于存量
   * 库文件探测（防止新建空库掩盖旧数据）。
   */
  open(options: {
    name: string;
    location?: string;
    failOnCreate?: boolean;
  }): Promise<void>;
  close(): Promise<void>;
  execute(sql: string, params?: unknown[]): Promise<OpSqliteResult>;
  /**
   * 同步 execute（可选能力，op-sqlite 系 adapter 提供）。
   *
   * 用途：OpSqliteConnection 在 BEGIN...COMMIT 事务内切换到同步调用——
   * 这是 quick-sqlite 时代实测得出的防御策略（真机：async execute 走
   * JSI 异步调度，长事务内大体积语句会 promise 永远挂起或报 disk I/O
   * error），op-sqlite 保留同一防御策略，事务内全同步 + 逐语句让出
   * 事件循环。
   */
  executeSync?(sql: string, params?: unknown[]): OpSqliteResult;
  /**
   * 旧 quick-sqlite 默认布局的绝对目录（Android `<files>/default`、
   * iOS `<DocumentDir>/default`），供存量库文件原地探测；平台常量不可用
   * （如测试 mock）时返回 undefined，调用方直接走默认布局。
   */
  getLegacyDefaultDir?(): string | undefined;
  /** 当前库文件的绝对路径（透传 op-sqlite `db.getDbPath()`），未打开时 undefined。 */
  getDbPath?(): string | undefined;
}
