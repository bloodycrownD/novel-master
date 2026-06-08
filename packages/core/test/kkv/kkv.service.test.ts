import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KkvError } from "../../src/errors/kkv-errors.js";
import { createKkvService } from "../../src/service/kkv/create-kkv-service.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";



novelMasterTestFixture();

describe("KkvService", () => {
  it("isolates keys per module", async () => {
    const ctx = getNovelMasterTestContext();
    const kkv = createKkvService(ctx.conn);
    await kkv.set("M1", "k", "v1");
    await kkv.set("M2", "k", "v2");
    assert.equal(await kkv.get("M1", "k"), "v1");
    assert.equal(await kkv.get("M2", "k"), "v2");
  });

  it("delete missing key throws NOT_FOUND", async () => {
    const ctx = getNovelMasterTestContext();
    const kkv = createKkvService(ctx.conn);
    await assert.rejects(
      () => kkv.delete("mod", "missing"),
      (e: unknown) => {
        assert.ok(e instanceof KkvError);
        assert.equal(e.code, "NOT_FOUND");
        return true;
      },
    );
  });

  it("lists keys in module", async () => {
    const ctx = getNovelMasterTestContext();
    const kkv = createKkvService(ctx.conn);
    await kkv.set("M", "a", "1");
    await kkv.set("M", "b", "2");
    const keys = await kkv.listKeys("M");
    assert.deepEqual(keys, ["a", "b"]);
  });
});
