import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

describe("SKSP schema", () => {
  it("creates sksp_secrets table on bootstrap", async () => {
    const ctx = await openNovelMasterTestConnection();
    const rows = await ctx.conn.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sksp_secrets'",
    );
    assert.equal(rows.length, 1);
    await ctx.conn.close();
  });
});
