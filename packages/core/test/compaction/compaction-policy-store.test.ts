import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compactionPolicySchema,
  decode,
  createCompactionPolicyStore,
} from "@novel-master/core";
import { CompactionPolicyError } from "../../src/errors/compaction-policy-errors.js";
import { createKkvService } from "../../src/service/kkv/create-kkv-service.js";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

describe("CompactionPolicyStore", () => {
  it("P3: set/get/clear round-trip", async () => {
    const ctx = await openNovelMasterTestConnection();
    const store = createCompactionPolicyStore(ctx.conn);
    const policy = decode(
      {
        schemaVersion: 1,
        enabled: true,
        trigger: { tokenThreshold: 100 },
        action: {
          keepLastN: 3,
          abstract: { type: "text", content: "summary" },
        },
      },
      compactionPolicySchema,
    );
    await store.setPolicy(policy);
    const loaded = await store.getPolicy();
    assert.deepEqual(loaded, policy);
    await store.clearPolicy();
    assert.equal(await store.getPolicy(), null);
    await ctx.conn.close();
  });

  it("throws CompactionPolicyError on invalid stored JSON", async () => {
    const ctx = await openNovelMasterTestConnection();
    const kkv = createKkvService(ctx.conn);
    await kkv.set("nm-compaction", "policy", "{not-json");
    const store = createCompactionPolicyStore(ctx.conn);
    await assert.rejects(
      () => store.getPolicy(),
      (e: unknown) =>
        e instanceof Error && e.name === "CompactionPolicyError",
    );
    await ctx.conn.close();
  });
});
