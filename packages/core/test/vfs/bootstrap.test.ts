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
});
