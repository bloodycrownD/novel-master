import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as coreMain from "@novel-master/core";
import { createKkvService, KkvError } from "@novel-master/core/kkv";
import { openNovelMasterTestConnection } from "./helpers/novel-master.js";

describe("T0 package exports (@novel-master/core entry)", () => {
  it("does not export createKkvService from main entry", () => {
    assert.equal(
      (coreMain as Record<string, unknown>).createKkvService,
      undefined,
    );
  });

  it("exports createKkvService and KkvError from @novel-master/core/kkv", async () => {
    assert.equal(typeof createKkvService, "function");
    assert.equal(KkvError.name, "KkvError");

    const ctx = await openNovelMasterTestConnection();
    const kkv = createKkvService(ctx.conn);
    await kkv.set("t0-smoke", "key", "value");
    assert.equal(await kkv.get("t0-smoke", "key"), "value");
    await ctx.conn.close();
  });
});
