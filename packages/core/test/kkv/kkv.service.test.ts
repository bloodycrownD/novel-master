import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KkvError } from "../../src/errors/kkv-errors.js";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";
import { createKkvService } from "../../src/service/kkv/create-kkv-service.js";

describe("KkvService", () => {
  it("isolates keys per module", async () => {
    const ctx = await openNovelMasterTestConnection();
    const kkv = createKkvService(ctx.conn);
    await kkv.set("M1", "k", "v1");
    await kkv.set("M2", "k", "v2");
    assert.equal(await kkv.get("M1", "k"), "v1");
    assert.equal(await kkv.get("M2", "k"), "v2");
    await ctx.conn.close();
  });

  it("delete missing key throws NOT_FOUND", async () => {
    const ctx = await openNovelMasterTestConnection();
    const kkv = createKkvService(ctx.conn);
    await assert.rejects(
      () => kkv.delete("mod", "missing"),
      (e: unknown) => {
        assert.ok(e instanceof KkvError);
        assert.equal(e.code, "NOT_FOUND");
        return true;
      },
    );
    await ctx.conn.close();
  });

  it("lists keys in module", async () => {
    const ctx = await openNovelMasterTestConnection();
    const kkv = createKkvService(ctx.conn);
    await kkv.set("M", "a", "1");
    await kkv.set("M", "b", "2");
    const keys = await kkv.listKeys("M");
    assert.deepEqual(keys, ["a", "b"]);
    await ctx.conn.close();
  });
});
