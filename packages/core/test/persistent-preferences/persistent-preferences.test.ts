import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PreferencesError } from "@novel-master/core";
import { createKkvService } from "../../src/service/kkv/create-kkv-service.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";



novelMasterTestFixture();

describe("PersistentPreferences", () => {
  it("versionCheck defaults to true when unset", async () => {
    const ctx = getNovelMasterTestContext();
    assert.equal(await ctx.preferences.getSessionFsVersionCheck(), true);
  });

  it("set false / true round-trips", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.preferences.setSessionFsVersionCheck(false);
    assert.equal(await ctx.preferences.getSessionFsVersionCheck(), false);
    await ctx.preferences.setSessionFsVersionCheck(true);
    assert.equal(await ctx.preferences.getSessionFsVersionCheck(), true);
  });

  it("reset restores default true", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.preferences.setSessionFsVersionCheck(false);
    await ctx.preferences.resetSessionFsVersionCheck();
    assert.equal(await ctx.preferences.getSessionFsVersionCheck(), true);
  });

  it("throws PreferencesError on invalid stored boolean", async () => {
    const ctx = getNovelMasterTestContext();
    const kkv = createKkvService(ctx.conn);
    await kkv.set("nm-preferences", "session-fs.versionCheck", "not-a-bool");
    await assert.rejects(
      () => ctx.preferences.getSessionFsVersionCheck(),
      (e: unknown) => e instanceof PreferencesError && e.code === "INVALID_VALUE",
    );
  });

  it("lists preference entries sorted by key", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.preferences.setSessionFsVersionCheck(false);
    const list = await ctx.preferences.list();
    assert.deepEqual(list, [{ key: "session-fs.versionCheck", value: "false" }]);
  });

  describe("v2 defaults (C1)", () => {
    it("llmStream defaults to true when unset", async () => {
      const ctx = getNovelMasterTestContext();
      assert.equal(await ctx.preferences.getLlmStreamEnabled(), true);
    });
  });

  describe("v2 reset (C3)", () => {
    it("reset llmStream restores default true", async () => {
      const ctx = getNovelMasterTestContext();
      await ctx.preferences.setLlmStreamEnabled(false);
      await ctx.preferences.resetLlmStreamEnabled();
      assert.equal(await ctx.preferences.getLlmStreamEnabled(), true);
    });
  });

  describe("v2 round-trip", () => {
    it("llmStream boolean round-trip", async () => {
      const ctx = getNovelMasterTestContext();
      await ctx.preferences.setLlmStreamEnabled(false);
      assert.equal(await ctx.preferences.getLlmStreamEnabled(), false);
    });
  });
});
