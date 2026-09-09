import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PreferencesError } from "@novel-master/core";
import { createKkvService } from "../../src/service/kkv/create-kkv-service.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";



novelMasterTestFixture();

describe("PersistentPreferences", () => {
  it("throws PreferencesError on invalid stored boolean", async () => {
    const ctx = getNovelMasterTestContext();
    const kkv = createKkvService(ctx.conn);
    await kkv.set("nm-preferences", "chat.llmStream", "not-a-bool");
    await assert.rejects(
      () => ctx.preferences.getLlmStreamEnabled(),
      (e: unknown) => e instanceof PreferencesError && e.code === "INVALID_VALUE",
    );
    // 清理：同库后续用例（v2 defaults）会读到该键，不能留脏值
    await ctx.preferences.resetLlmStreamEnabled();
  });

  it("lists preference entries sorted by key", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.preferences.setLlmStreamEnabled(false);
    const list = await ctx.preferences.list();
    assert.deepEqual(list, [{ key: "chat.llmStream", value: "false" }]);
    await ctx.preferences.resetLlmStreamEnabled();
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

  describe("vfs.userVfsUnifiedToolTurn", () => {
    it("defaults to true when unset", async () => {
      const ctx = getNovelMasterTestContext();
      assert.equal(await ctx.preferences.getUserVfsUnifiedToolTurn(), true);
    });

    it("boolean round-trip and reset", async () => {
      const ctx = getNovelMasterTestContext();
      await ctx.preferences.setUserVfsUnifiedToolTurn(false);
      assert.equal(await ctx.preferences.getUserVfsUnifiedToolTurn(), false);
      await ctx.preferences.resetUserVfsUnifiedToolTurn();
      assert.equal(await ctx.preferences.getUserVfsUnifiedToolTurn(), true);
    });

    it("throws PreferencesError on invalid stored boolean", async () => {
      const ctx = getNovelMasterTestContext();
      const kkv = createKkvService(ctx.conn);
      await kkv.set("nm-preferences", "vfs.userVfsUnifiedToolTurn", "not-a-bool");
      await assert.rejects(
        () => ctx.preferences.getUserVfsUnifiedToolTurn(),
        (e: unknown) => e instanceof PreferencesError && e.code === "INVALID_VALUE",
      );
    });
  });

  describe("chat.thinkingContext", () => {
    it("defaults to false when unset", async () => {
      const ctx = getNovelMasterTestContext();
      assert.equal(await ctx.preferences.getThinkingContextEnabled(), false);
    });

    it("set true 后 get 为 true，reset 后回到 false", async () => {
      const ctx = getNovelMasterTestContext();
      await ctx.preferences.setThinkingContextEnabled(true);
      assert.equal(await ctx.preferences.getThinkingContextEnabled(), true);
      await ctx.preferences.resetThinkingContextEnabled();
      assert.equal(await ctx.preferences.getThinkingContextEnabled(), false);
    });

    it("throws PreferencesError on invalid stored boolean", async () => {
      const ctx = getNovelMasterTestContext();
      const kkv = createKkvService(ctx.conn);
      await kkv.set("nm-preferences", "chat.thinkingContext", "not-a-bool");
      await assert.rejects(
        () => ctx.preferences.getThinkingContextEnabled(),
        (e: unknown) => e instanceof PreferencesError && e.code === "INVALID_VALUE",
      );
    });
  });
});
