import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bootstrapNovelMaster } from "../../src/bootstrap/novel-master-bootstrap.js";
import {
  BUILTIN_PROVIDER_KEYS,
  BUILTIN_PROVIDER_PROTOCOLS,
  BUILTIN_PROVIDER_UUIDS,
  BUILTIN_UUID_TO_KEY,
} from "../../src/domain/provider/logic/builtin-providers.js";
import { getNovelMasterTestContext, novelMasterTestFixture } from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("bootstrap seed providers", () => {
  it("seeds five built-in providers once（固定 UUID + builtin_key）", async () => {
    const ctx = getNovelMasterTestContext();
    const rows = await ctx.conn.query<{
      id: string;
      builtin_key: string;
    }>("SELECT id, builtin_key FROM llm_provider ORDER BY builtin_key");
    assert.deepEqual(
      rows.map((r) => r.builtin_key),
      [...BUILTIN_PROVIDER_KEYS].sort(),
    );
    assert.deepEqual(
      new Set(rows.map((r) => r.id)),
      new Set(BUILTIN_PROVIDER_UUIDS),
    );
    await bootstrapNovelMaster(ctx.conn);
    const again = await ctx.conn.query<{ id: string }>(
      "SELECT id FROM llm_provider ORDER BY id",
    );
    assert.equal(again.length, 5);
  });

  it("seed protocol column matches shared builtin map（按 builtin_key）", async () => {
    const ctx = getNovelMasterTestContext();
    const rows = await ctx.conn.query<{
      id: string;
      builtin_key: string;
      protocol: string;
    }>("SELECT id, builtin_key, protocol FROM llm_provider ORDER BY builtin_key");
    for (const row of rows) {
      assert.equal(row.protocol, BUILTIN_PROVIDER_PROTOCOLS[row.builtin_key]);
      assert.equal(BUILTIN_UUID_TO_KEY[row.id], row.builtin_key);
    }
  });
});
