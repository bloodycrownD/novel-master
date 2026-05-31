/**
 * In-memory {@link RnSqliteAdapter} for Node CI (backed by better-sqlite3).
 *
 * @module tdbc-driver-rn/test/mock-adapter
 */

import Database from "better-sqlite3";
import type { QuickSqliteResult, RnSqliteAdapter } from "../src/adapter.js";

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
 * Mock adapter with SQLite semantics for conformance tests in Node.
 */
export class MockRnSqliteAdapter implements RnSqliteAdapter {
  private db?: Database.Database;

  async open(): Promise<void> {
    this.db = new Database(":memory:");
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = undefined;
  }

  async execute(sql: string, params: unknown[] = []): Promise<QuickSqliteResult> {
    const db = this.db;
    if (!db) {
      throw new Error("MockRnSqliteAdapter is not open");
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
