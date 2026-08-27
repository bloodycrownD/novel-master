import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bootstrapNovelMaster,
  SCHEMA_BOOT_VERSION,
} from "@novel-master/core";

import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("bootstrapNovelMaster", () => {
  it("is idempotent on empty database", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    await bootstrapNovelMaster(conn);
    await bootstrapNovelMaster(conn);
    const rows = await conn.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vfs_entry'`,
    );
    assert.equal(rows.length, 1);
  });

  it("writes SCHEMA_BOOT_VERSION and second boot stays at that version", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    await bootstrapNovelMaster(conn);
    const afterFirst = await conn.query<{ user_version: number }>(
      "PRAGMA user_version",
    );
    assert.equal(Number(afterFirst[0]?.user_version), SCHEMA_BOOT_VERSION);

    await bootstrapNovelMaster(conn);
    const afterSecond = await conn.query<{ user_version: number }>(
      "PRAGMA user_version",
    );
    assert.equal(Number(afterSecond[0]?.user_version), SCHEMA_BOOT_VERSION);
  });

  it("T-V5：发号器修复报告含 error 时 bootstrap 输出 console.warn", async () => {
    const ctx = getNovelMasterTestContext();
    // 只拦住对 sqlite_sequence 的读取（bootstrap 链路里仅 entry-sequence
    // repair 会查它），模拟 op-sqlite 等驱动读发号器失败，其余查询原样放行
    const brokenConn = new Proxy(ctx.conn, {
      get(target, prop) {
        if (prop === "query") {
          const rawQuery = target.query.bind(target);
          return async (
            sql: string,
            parameters?: readonly unknown[],
          ) => {
            if (sql.includes("FROM sqlite_sequence")) {
              throw new Error("mock: sqlite_sequence 读取失败");
            }
            return rawQuery(sql, parameters);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function"
          ? value.bind(target)
          : value;
      },
    });

    const warns: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args);
    };
    try {
      await bootstrapNovelMaster(brokenConn);
    } finally {
      console.warn = originalWarn;
    }

    const matched = warns.some((args) =>
      args.some(
        (a) =>
          typeof a === "string" && a.includes("vfs-entry-sequence-repair"),
      ),
    );
    assert.ok(
      matched,
      "发号器修复报告含 error 时应有 console.warn（携带操作名）",
    );
  });
});
