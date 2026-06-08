import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createKkvService } from "../../src/service/kkv/create-kkv-service.js";
import { KkvModelSuggestionRepository } from "../../src/domain/provider/repositories/impl/kkv-model-suggestion.repository.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";


novelMasterTestFixture();

describe("KkvModelSuggestionRepository", () => {
  it("fetch upserts to KKV and provider delete clears key", async () => {
    const ctx = getNovelMasterTestContext();
    const kkv = createKkvService(ctx.conn);
    const repo = new KkvModelSuggestionRepository(kkv);

    await repo.upsert({
      providerId: "openai",
      vendorModelId: "gpt-4o",
      displayName: "GPT-4o",
      stale: false,
      lastSeenAtMs: 1000,
    });
    await repo.upsert({
      providerId: "openai",
      vendorModelId: "gpt-4o-mini",
      displayName: null,
      stale: false,
      lastSeenAtMs: 2000,
    });

    const list = await repo.listByProvider("openai");
    assert.equal(list.length, 2);

    const raw = await kkv.get("nm-model-suggestions", "openai");
    assert.match(raw, /gpt-4o/);

    await repo.markStaleExcept("openai", new Set(["gpt-4o"]));
    const afterStale = await repo.listByProvider("openai");
    const mini = afterStale.find((s) => s.vendorModelId === "gpt-4o-mini");
    assert.equal(mini?.stale, true);

    await repo.deleteByProvider("openai");
    const keys = await kkv.listKeys("nm-model-suggestions");
    assert.ok(!keys.includes("openai"));
  });
});
