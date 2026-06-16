import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bootstrapNovelMaster, open } from "@novel-master/core";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";

describe("bootstrap DDL smoke (T-B1)", () => {
  it("空库 bootstrap 后关键表存在", async () => {
    registerBetterSqlite3Driver();
    const conn = await open("tdbc:sqlite:file::memory:", {
      driver: BETTER_SQLITE3_DRIVER_NAME,
      filename: ":memory:",
    });
    await bootstrapNovelMaster(conn);

    for (const tableName of [
      "agent_definition",
      "chat_session",
      "vfs_entry",
    ] as const) {
      const rows = await conn.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${tableName}'`,
      );
      assert.equal(rows.length, 1, `表 ${tableName} 应存在`);
    }

    await conn.close();
  });
});
