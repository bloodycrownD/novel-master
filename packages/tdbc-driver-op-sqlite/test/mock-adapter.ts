/**
 * Node CI 用的内存版 {@link OpSqliteAdapter}（better-sqlite3 实现）。
 *
 * @module tdbc-driver-op-sqlite/test/mock-adapter
 */

import Database from "better-sqlite3";
import type { OpSqliteResult, OpSqliteAdapter } from "../src/adapter.js";

function isReadQuery(sql: string): boolean {
  const trimmed = sql.trim().toUpperCase();
  return trimmed.startsWith("SELECT") || trimmed.startsWith("WITH");
}

function normalizeMockParams(params: unknown[]): unknown[] {
  return params.map((value) => {
    if (value instanceof ArrayBuffer) {
      return Buffer.from(value);
    }
    if (value instanceof Uint8Array) {
      return Buffer.from(value);
    }
    return value;
  });
}

/**
 * 测试用带 SQLite 语义的 mock adapter（Node 下跑 conformance）。
 */
export class MockOpSqliteAdapter implements OpSqliteAdapter {
  private db?: Database.Database;

  async open(): Promise<void> {
    this.db = new Database(":memory:");
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = undefined;
  }

  async execute(sql: string, params: unknown[] = []): Promise<OpSqliteResult> {
    const db = this.db;
    if (!db) {
      throw new Error("MockOpSqliteAdapter is not open");
    }

    if (isReadQuery(sql)) {
      const rows = db
        .prepare(sql)
        .all(...normalizeMockParams(params)) as Record<string, unknown>[];
      return { rows, rowsAffected: 0 };
    }

    const info = db.prepare(sql).run(...normalizeMockParams(params));
    return {
      rowsAffected: info.changes,
      insertId: Number(info.lastInsertRowid),
    };
  }
}
