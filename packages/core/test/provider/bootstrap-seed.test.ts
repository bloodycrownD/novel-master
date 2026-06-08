import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bootstrapNovelMaster } from "../../src/bootstrap/novel-master-bootstrap.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";


novelMasterTestFixture();

describe("bootstrap seed providers", () => {
  it("seeds four built-in providers once", async () => {
    const ctx = getNovelMasterTestContext();
    const rows = await ctx.conn.query<{ id: string }>(
      "SELECT id FROM llm_provider ORDER BY id",
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      ["anthropic", "google", "openai", "openrouter"],
    );
    await bootstrapNovelMaster(ctx.conn);
    const again = await ctx.conn.query<{ id: string }>(
      "SELECT id FROM llm_provider ORDER BY id",
    );
    assert.equal(again.length, 4);
  });
});
