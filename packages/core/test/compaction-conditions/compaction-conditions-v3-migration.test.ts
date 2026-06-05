import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compactionConditionsSchema,
  createCompactionConditionsStore,
  decode,
} from "@novel-master/core";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";
import { createKkvService } from "../../src/service/kkv/create-kkv-service.js";

describe("compaction conditions v3 migration", () => {
  it("v2 KKV read-once migrates to v3 and writes back", async () => {
    const ctx = await openNovelMasterTestConnection();
    const kkv = createKkvService(ctx.conn);
    const store = createCompactionConditionsStore(ctx.conn);

    await kkv.set(
      "nm-compaction-conditions",
      "policy",
      JSON.stringify({
        schemaVersion: 2,
        enabled: true,
        tokenThreshold: 12000,
        visibleFloor: 20,
      }),
    );

    const first = await store.getConditions();
    assert.equal(first?.schemaVersion, 3);
    assert.equal(first?.tokenRatio, 0.8);
    assert.equal(first?.visibleFloor, 20);
    assert.equal("tokenThreshold" in (first ?? {}), false);

    const raw = await kkv.get("nm-compaction-conditions", "policy");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(parsed.schemaVersion, 3);
    assert.equal(parsed.tokenThreshold, undefined);

    await ctx.conn.close();
  });

  it("v2 set is rejected", () => {
    assert.throws(() => {
      decode(
        { schemaVersion: 2, enabled: true, tokenThreshold: 12000 },
        compactionConditionsSchema,
      );
    });
  });
});
