import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getNovelMasterTestContext, novelMasterTestFixture } from "../helpers/novel-master-fixture.js";

const TEST_SAVED_MODEL_ID = "00000000-0000-4000-8000-000000000099";

novelMasterTestFixture();

describe("PersistentState", () => {
  it("sets and gets all workspace pointers including regex group", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.state.setCurrentProjectId("p1");
    await ctx.state.setCurrentSessionId("s1");
    await ctx.state.setCurrentProviderId("prov1");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);
    await ctx.state.setCurrentRegexGroupId("regex-g1");
    await ctx.state.setCurrentAgentId("agent-1");
    assert.equal(await ctx.state.getCurrentProjectId(), "p1");
    assert.equal(await ctx.state.getCurrentSessionId(), "s1");
    assert.equal(await ctx.state.getCurrentProviderId(), "prov1");
    assert.equal(await ctx.state.getCurrentModelId(), TEST_SAVED_MODEL_ID);
    assert.equal(await ctx.state.getCurrentRegexGroupId(), "regex-g1");
    assert.equal(await ctx.state.getCurrentAgentId(), "agent-1");
  });

  it("setCurrentModelId 拒绝 legacy provider/vendor 指针", async () => {
    const ctx = getNovelMasterTestContext();
    await assert.rejects(() => ctx.state.setCurrentModelId("prov1/model"));
  });

  it("returns undefined for missing keys", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.state.resetCurrentProjectId();
    await ctx.state.resetCurrentSessionId();
    await ctx.state.resetCurrentProviderId();
    await ctx.state.resetCurrentModelId();
    await ctx.state.resetCurrentRegexGroupId();
    await ctx.state.resetCurrentAgentId();
    assert.equal(await ctx.state.getCurrentProjectId(), undefined);
    assert.equal(await ctx.state.getCurrentSessionId(), undefined);
    assert.equal(await ctx.state.getCurrentAgentId(), undefined);
  });

  it("reset clears a pointer", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.state.setCurrentProjectId("p1");
    await ctx.state.resetCurrentProjectId();
    assert.equal(await ctx.state.getCurrentProjectId(), undefined);
  });

  it("resetCurrentRegexGroupId clears regex pointer", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.state.setCurrentRegexGroupId("g");
    await ctx.state.resetCurrentRegexGroupId();
    assert.equal(await ctx.state.getCurrentRegexGroupId(), undefined);
  });

  it("resetCurrentAgentId clears agent pointer", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.state.setCurrentAgentId("a1");
    await ctx.state.resetCurrentAgentId();
    assert.equal(await ctx.state.getCurrentAgentId(), undefined);
  });

  it("resetCurrentAgentId is idempotent", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.state.resetCurrentAgentId();
  });
});
