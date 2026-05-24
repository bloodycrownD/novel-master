import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bootstrapNovelMaster } from "@novel-master/core";
import { openVfsTestConnection } from "./helpers.js";

describe("bootstrapNovelMaster", () => {
  it("is idempotent on empty database", async () => {
    const { conn } = await openVfsTestConnection();
    await bootstrapNovelMaster(conn);
    await bootstrapNovelMaster(conn);
    const rows = await conn.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vfs_entry'`,
    );
    assert.equal(rows.length, 1);
    await conn.close();
  });
});
