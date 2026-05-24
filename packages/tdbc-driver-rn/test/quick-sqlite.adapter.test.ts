/**
 * Unit tests for {@link BaseQuickSqliteAdapter} with mock bindings.
 *
 * @module tdbc-driver-rn/test/quick-sqlite.adapter
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QuickSqliteResult } from "../src/adapter.js";
import { BaseQuickSqliteAdapter } from "../src/impl/quick-sqlite.adapter.js";

describe("BaseQuickSqliteAdapter", () => {
  it("opens with location default and closes handle", async () => {
    let closed = false;
    const openCalls: { name: string; location?: string }[] = [];

    const adapter = new BaseQuickSqliteAdapter({
      open: (options) => {
        openCalls.push(options);
        return { close: () => { closed = true; } };
      },
      QuickSQLite: {
        execute: () => ({ rowsAffected: 0 }),
      },
    });

    await adapter.open({ name: "novel_master_vfs" });
    assert.deepEqual(openCalls, [{ name: "novel_master_vfs", location: "default" }]);

    await adapter.close();
    assert.equal(closed, true);
  });

  it("prefers executeAsync over execute", async () => {
    const calls: string[] = [];
    const asyncResult: QuickSqliteResult = { rowsAffected: 1, insertId: 42 };

    const adapter = new BaseQuickSqliteAdapter({
      open: () => ({ close: () => {} }),
      QuickSQLite: {
        execute: (_db, sql) => {
          calls.push(`sync:${sql}`);
          return { rowsAffected: 0 };
        },
        executeAsync: async (_db, sql, params) => {
          calls.push(`async:${sql}:${JSON.stringify(params)}`);
          return asyncResult;
        },
      },
    });

    await adapter.open({ name: "testdb", location: "custom" });
    const result = await adapter.execute("INSERT INTO t VALUES (?)", [7]);

    assert.deepEqual(calls, ["async:INSERT INTO t VALUES (?):[7]"]);
    assert.deepEqual(result, asyncResult);
  });

  it("falls back to execute when executeAsync is absent", async () => {
    const syncResult: QuickSqliteResult = { rows: [{ id: 1 }] };

    const adapter = new BaseQuickSqliteAdapter({
      open: () => ({ close: () => {} }),
      QuickSQLite: {
        execute: (_db, sql, params) => {
          assert.equal(sql, "SELECT 1");
          assert.deepEqual(params, []);
          return syncResult;
        },
      },
    });

    await adapter.open({ name: "testdb" });
    const result = await adapter.execute("SELECT 1");

    assert.deepEqual(result, syncResult);
  });
});
