import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bootstrapNovelMaster } from "@novel-master/core";

import { createVfsService } from "@novel-master/core/vfs";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";


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
});
