import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bootstrapNovelMaster } from "@novel-master/core";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import { open } from "../../src/infra/tdbc/index.js";

describe("chat_message.hidden bootstrap migration", () => {
  it("T2: adds hidden column to legacy chat_message tables", async () => {
    registerBetterSqlite3Driver();
    const conn = await open("tdbc:sqlite:file::memory:", {
      driver: BETTER_SQLITE3_DRIVER_NAME,
      filename: ":memory:",
    });

    await conn.execute(
      `CREATE TABLE chat_message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        role TEXT NOT NULL,
        content_json TEXT NOT NULL,
        provider TEXT,
        raw_json TEXT,
        created_at_ms INTEGER NOT NULL,
        UNIQUE (session_id, seq)
      )`,
      [],
    );

    await bootstrapNovelMaster(conn);

    const cols = await conn.query(
      "SELECT name, [notnull], dflt_value FROM pragma_table_info('chat_message')",
    );
    const hidden = cols.find((c) => String(c.name) === "hidden");
    assert.ok(hidden);
    assert.equal(Number(hidden!.notnull), 1);
    assert.equal(String(hidden!.dflt_value), "0");

    await conn.close();
  });
});
