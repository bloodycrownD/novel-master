import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAppError } from "../../src/errors/app-error.js";
import { getNovelMasterTestContext, novelMasterTestFixture } from "../helpers/novel-master-fixture.js";

const TEST_SAVED_MODEL_ID = "00000000-0000-4000-8000-000000000099";

/** get 断言的公共形态：先钉 ok，再比 value（不放宽断言语义）。 */
async function expectGet(read: Promise<ResultLike>, expected: string | undefined): Promise<void> {
  const r = await read;
  assert.ok(r.ok, "读指针应成功");
  if (r.ok) assert.equal(r.value, expected);
}

type ResultLike = { ok: true; value: string | undefined } | { ok: false; error: unknown };

novelMasterTestFixture();

describe("PersistentState", () => {
  it("sets and gets all workspace pointers", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.state.setCurrentProjectId("p1");
    await ctx.state.setCurrentSessionId("s1");
    await ctx.state.setCurrentProviderId("prov1");
    const setModel = await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);
    assert.ok(setModel.ok, "setCurrentModelId 应成功");
    const setAgent = await ctx.state.setCurrentAgentId("agent-1");
    assert.ok(setAgent.ok, "setCurrentAgentId 应成功");
    await expectGet(ctx.state.getCurrentProjectId(), "p1");
    await expectGet(ctx.state.getCurrentSessionId(), "s1");
    await expectGet(ctx.state.getCurrentProviderId(), "prov1");
    await expectGet(ctx.state.getCurrentModelId(), TEST_SAVED_MODEL_ID);
    await expectGet(ctx.state.getCurrentAgentId(), "agent-1");
  });

  it("setCurrentModelId 拒绝 legacy provider/vendor 指针", async () => {
    const ctx = getNovelMasterTestContext();
    const r = await ctx.state.setCurrentModelId("prov1/model");
    assert.ok(!r.ok, "legacy 指针应走 Err 通道");
    if (!r.ok) assert.ok(isAppError(r.error, "PROVIDER_INVALID_SAVED_MODEL_ID"));
  });

  it("returns undefined for missing keys", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.state.resetCurrentProjectId();
    await ctx.state.resetCurrentSessionId();
    await ctx.state.resetCurrentProviderId();
    await ctx.state.resetCurrentModelId();
    await ctx.state.resetCurrentAgentId();
    await expectGet(ctx.state.getCurrentProjectId(), undefined);
    await expectGet(ctx.state.getCurrentSessionId(), undefined);
    await expectGet(ctx.state.getCurrentAgentId(), undefined);
  });

  it("reset clears a pointer", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.state.setCurrentProjectId("p1");
    await ctx.state.resetCurrentProjectId();
    await expectGet(ctx.state.getCurrentProjectId(), undefined);
  });

  it("resetCurrentAgentId clears agent pointer", async () => {
    const ctx = getNovelMasterTestContext();
    const setAgent = await ctx.state.setCurrentAgentId("a1");
    assert.ok(setAgent.ok, "setCurrentAgentId 应成功");
    await ctx.state.resetCurrentAgentId();
    await expectGet(ctx.state.getCurrentAgentId(), undefined);
  });

  it("resetCurrentAgentId is idempotent", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.state.resetCurrentAgentId();
  });
});
