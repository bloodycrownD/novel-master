import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

describe("PersistentState", () => {
  it("sets and gets all four workspace pointers", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.state.setCurrentProjectId("p1");
    await ctx.state.setCurrentSessionId("s1");
    await ctx.state.setCurrentProviderId("prov1");
    await ctx.state.setCurrentModelId("prov1/model");
    assert.equal(await ctx.state.getCurrentProjectId(), "p1");
    assert.equal(await ctx.state.getCurrentSessionId(), "s1");
    assert.equal(await ctx.state.getCurrentProviderId(), "prov1");
    assert.equal(await ctx.state.getCurrentModelId(), "prov1/model");
    await ctx.conn.close();
  });

  it("returns undefined for missing keys", async () => {
    const ctx = await openNovelMasterTestConnection();
    assert.equal(await ctx.state.getCurrentProjectId(), undefined);
    assert.equal(await ctx.state.getCurrentSessionId(), undefined);
    await ctx.conn.close();
  });

  it("reset clears a pointer", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.state.setCurrentProjectId("p1");
    await ctx.state.resetCurrentProjectId();
    assert.equal(await ctx.state.getCurrentProjectId(), undefined);
    await ctx.conn.close();
  });

  it("reset is idempotent (no error on missing key)", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.state.resetCurrentSessionId();
    await ctx.conn.close();
  });
});
