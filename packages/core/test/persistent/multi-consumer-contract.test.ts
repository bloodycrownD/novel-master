import {  unwrap  } from "../helpers/result-unwrap.js";
import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  createPersistentPreferences, PersistentStateFactory  } from "@novel-master/core";
import {  createKkvService  } from "../../src/service/kkv/create-kkv-service.js";
import {  getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix  } from "../helpers/novel-master-fixture.js";



novelMasterTestFixture();

describe("PersistentState / PersistentPreferences multi-consumer", () => {
    it("two state instances on same connection see the same project id", async () => {
        const ctx = getNovelMasterTestContext();
        const a = PersistentStateFactory.create(ctx.conn);
        const b = PersistentStateFactory.create(ctx.conn);
        await a.setCurrentProjectId("shared-project");
        assert.equal(unwrap(await b.getCurrentProjectId()), "shared-project");
    });

    it("two preferences instances on same connection see llmStream", async () => {
        const ctx = getNovelMasterTestContext();
        const a = createPersistentPreferences(ctx.conn);
        const b = createPersistentPreferences(ctx.conn);
        await a.setLlmStreamEnabled(false);
        assert.equal(unwrap(await b.getLlmStreamEnabled()), false);
    });

    it("does not read legacy global-config module", async () => {
        const ctx = getNovelMasterTestContext();
        await ctx.state.resetCurrentProjectId();
        const kkv = createKkvService(ctx.conn);
        await kkv.set("global-config", "currentProjectId", "legacy-id");
        assert.equal(unwrap(await ctx.state.getCurrentProjectId()), undefined);
        await ctx.state.setCurrentProjectId("new-id");
        assert.equal(unwrap(await kkv.get("nm-workspace-state", "currentProjectId")), "new-id");
    });
});
