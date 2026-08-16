/**
 * op-sqlite adapter 共享核心（bindings 注入；不直接 import peer）。
 *
 * @module tdbc-driver-op-sqlite/impl/op-sqlite.adapter
 */

import type { OpSqliteResult, OpSqliteAdapter } from "../adapter.js";

/** op-sqlite 原生 execute 结果（metadata 为 {name, type, index} 形态）。 */
type OpSqliteRawResult = {
  rows?: (Record<string, unknown> | unknown[])[];
  rowsAffected?: number;
  insertId?: number;
  columnNames?: string[];
  metadata?: { name: string; type?: string; index?: number }[];
};

/** op-sqlite 连接对象（DB）的最小调用面（实例方法模型）。 */
type OpSqliteDb = {
  execute: (sql: string, params?: unknown[]) => Promise<OpSqliteRawResult>;
  executeSync: (sql: string, params?: unknown[]) => OpSqliteRawResult;
  close: () => void;
  getDbPath: (location?: string) => string;
};

/** 构造注入的 op-sqlite 模块表面（非 port，便于测试 fake）。 */
export type OpSqliteBindings = {
  open: (options: {
    name: string;
    location?: string;
    failOnCreate?: boolean;
  }) => OpSqliteDb;
  /**
   * 平台路径常量（Android 上 IOS_* 为 null，iOS 上 ANDROID_* 为 null；
   * Node / web 环境可能均不可用）。
   */
  ANDROID_FILES_PATH?: string | null;
  IOS_DOCUMENT_PATH?: string | null;
};

/** 把 op-sqlite 的 metadata 字段 `{name, type, index}` 转换为契约的 `{columnName}`。 */
function convertMetadata(
  metadata: OpSqliteRawResult["metadata"],
): { columnName: string }[] | undefined {
  if (!metadata || metadata.length === 0) {
    return undefined;
  }
  return metadata.map((m) => ({ columnName: m.name }));
}

function convertResult(raw: OpSqliteRawResult): OpSqliteResult {
  // 集中在此处做字段名转换：rows 纯数组直接透传（row-mapper 已兼容），
  // columnNames 真实存在（quick-sqlite 8.2.7 运行时没有）也直接透传。
  return {
    rows: raw.rows,
    rowsAffected: raw.rowsAffected,
    insertId: raw.insertId,
    columnNames: raw.columnNames,
    metadata: convertMetadata(raw.metadata),
  };
}

/**
 * 基于注入 bindings 的 {@link OpSqliteAdapter} 核心实现。
 *
 * op-sqlite 是连接对象模型：`open()` 返回 `DB` 实例并持住，后续所有
 * 调用走实例方法（不再有全局 QuickSQLite + dbName 寻址）。注意命名
 * 反转：`execute` 是异步（Promise），`executeSync` 才是同步。
 */
export class BaseOpSqliteAdapter implements OpSqliteAdapter {
  private readonly bindings: OpSqliteBindings;
  private db?: OpSqliteDb;

  constructor(bindings: OpSqliteBindings) {
    this.bindings = bindings;
  }

  async open(options: {
    name: string;
    location?: string;
    failOnCreate?: boolean;
  }): Promise<void> {
    // 持住 DB 连接对象：execute/executeSync/close/getDbPath 都走实例方法。
    this.db = this.bindings.open({
      name: options.name,
      location: options.location,
      failOnCreate: options.failOnCreate,
    });
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = undefined;
  }

  async execute(sql: string, params?: unknown[]): Promise<OpSqliteResult> {
    const db = this.requireDb();
    // op-sqlite 命名反转：execute 是异步版本（Promise）。
    return convertResult(await db.execute(sql, params ?? []));
  }

  executeSync(sql: string, params?: unknown[]): OpSqliteResult {
    const db = this.requireDb();
    // executeSync 才是同步版本：JSI 直调、阻塞 JS 线程，供事务内切换使用。
    return convertResult(db.executeSync(sql, params ?? []));
  }

  getLegacyDefaultDir(): string | undefined {
    // quick-sqlite 的 location: 'default' 布局：Android 落在
    // <files>/default/<name>，iOS 落在 <DocumentDir>/default/<name>。
    // 平台常量一边为 null（另一平台），均不可用时返回 undefined。
    const base =
      this.bindings.ANDROID_FILES_PATH ?? this.bindings.IOS_DOCUMENT_PATH;
    if (typeof base !== "string" || base.length === 0) {
      return undefined;
    }
    return `${base}/default`;
  }

  getDbPath(): string | undefined {
    return this.db?.getDbPath();
  }

  private requireDb(): OpSqliteDb {
    if (!this.db) {
      throw new Error("op-sqlite adapter is not open");
    }
    return this.db;
  }
}
