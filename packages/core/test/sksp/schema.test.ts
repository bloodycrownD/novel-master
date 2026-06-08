import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";


novelMasterTestFixture();

describe("SKSP schema", () => {
  it("creates sksp_secrets table on bootstrap", async () => {
    const ctx = getNovelMasterTestContext();
    const rows = await ctx.conn.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sksp_secrets'",
    );
    assert.equal(rows.length, 1);
  });
});
