import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createPersistentPreferences,
  createPersistentState,
} from "@novel-master/core";
import { createKkvService } from "../../src/service/kkv/create-kkv-service.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";



novelMasterTestFixture();

describe("PersistentState / PersistentPreferences multi-consumer", () => {
  it("two state instances on same connection see the same project id", async () => {
    const ctx = getNovelMasterTestContext();
    const a = createPersistentState(ctx.conn);
    const b = createPersistentState(ctx.conn);
    await a.setCurrentProjectId("shared-project");
    assert.equal(await b.getCurrentProjectId(), "shared-project");
  });

  it("two preferences instances on same connection see versionCheck", async () => {
    const ctx = getNovelMasterTestContext();
    const a = createPersistentPreferences(ctx.conn);
    const b = createPersistentPreferences(ctx.conn);
    await a.setSessionFsVersionCheck(false);
    assert.equal(await b.getSessionFsVersionCheck(), false);
  });

  it("does not read legacy global-config module", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.state.resetCurrentProjectId();
    const kkv = createKkvService(ctx.conn);
    await kkv.set("global-config", "currentProjectId", "legacy-id");
    assert.equal(await ctx.state.getCurrentProjectId(), undefined);
    await ctx.state.setCurrentProjectId("new-id");
    assert.equal(await kkv.get("nm-workspace-state", "currentProjectId"), "new-id");
  });
});
