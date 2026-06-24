import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bootstrapNovelMaster } from "../../src/bootstrap/novel-master-bootstrap.js";
import { BUILTIN_PROVIDER_PROTOCOLS } from "../../src/domain/provider/logic/builtin-providers.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";


novelMasterTestFixture();

describe("bootstrap seed providers", () => {
  it("seeds five built-in providers once", async () => {
    const ctx = getNovelMasterTestContext();
    const rows = await ctx.conn.query<{ id: string }>(
      "SELECT id FROM llm_provider ORDER BY id",
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      ["anthropic", "google", "openai", "opencode", "openrouter"],
    );
    await bootstrapNovelMaster(ctx.conn);
    const again = await ctx.conn.query<{ id: string }>(
      "SELECT id FROM llm_provider ORDER BY id",
    );
    assert.equal(again.length, 5);
  });

  it("seed protocol column matches shared builtin map", async () => {
    const ctx = getNovelMasterTestContext();
    const rows = await ctx.conn.query<{ id: string; protocol: string }>(
      "SELECT id, protocol FROM llm_provider ORDER BY id",
    );
    for (const row of rows) {
      assert.equal(row.protocol, BUILTIN_PROVIDER_PROTOCOLS[row.id]);
    }
  });
});
