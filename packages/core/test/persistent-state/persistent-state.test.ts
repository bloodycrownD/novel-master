import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

describe("PersistentState", () => {
  it("sets and gets all workspace pointers including regex group", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.state.setCurrentProjectId("p1");
    await ctx.state.setCurrentSessionId("s1");
    await ctx.state.setCurrentProviderId("prov1");
    await ctx.state.setCurrentModelId("prov1/model");
    await ctx.state.setCurrentRegexGroupId("regex-g1");
    await ctx.state.setCurrentAgentId("agent-1");
    assert.equal(await ctx.state.getCurrentProjectId(), "p1");
    assert.equal(await ctx.state.getCurrentSessionId(), "s1");
    assert.equal(await ctx.state.getCurrentProviderId(), "prov1");
    assert.equal(await ctx.state.getCurrentModelId(), "prov1/model");
    assert.equal(await ctx.state.getCurrentRegexGroupId(), "regex-g1");
    assert.equal(await ctx.state.getCurrentAgentId(), "agent-1");
    await ctx.conn.close();
  });

  it("returns undefined for missing keys", async () => {
    const ctx = await openNovelMasterTestConnection();
    assert.equal(await ctx.state.getCurrentProjectId(), undefined);
    assert.equal(await ctx.state.getCurrentSessionId(), undefined);
    assert.equal(await ctx.state.getCurrentAgentId(), undefined);
    await ctx.conn.close();
  });

  it("reset clears a pointer", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.state.setCurrentProjectId("p1");
    await ctx.state.resetCurrentProjectId();
    assert.equal(await ctx.state.getCurrentProjectId(), undefined);
    await ctx.conn.close();
  });

  it("resetCurrentRegexGroupId clears regex pointer", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.state.setCurrentRegexGroupId("g");
    await ctx.state.resetCurrentRegexGroupId();
    assert.equal(await ctx.state.getCurrentRegexGroupId(), undefined);
    await ctx.conn.close();
  });

  it("resetCurrentAgentId clears agent pointer", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.state.setCurrentAgentId("a1");
    await ctx.state.resetCurrentAgentId();
    assert.equal(await ctx.state.getCurrentAgentId(), undefined);
    await ctx.conn.close();
  });

  it("resetCurrentAgentId is idempotent", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.state.resetCurrentAgentId();
    await ctx.conn.close();
  });
});
