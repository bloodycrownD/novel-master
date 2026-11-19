import {  AppErrorOps  } from "../../src/errors/app-error.js";
import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  createKkvService  } from "../../src/service/kkv/create-kkv-service.js";
import {  getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix  } from "../helpers/novel-master-fixture.js";



novelMasterTestFixture();

describe("PersistentPreferences", () => {
  it("throws PreferencesError on invalid stored boolean", async () => {
    const ctx = getNovelMasterTestContext();
    const kkv = createKkvService(ctx.conn);
    await kkv.set("nm-preferences", "chat.llmStream", "not-a-bool");
    const r = await ctx.preferences.getLlmStreamEnabled();
    assert.ok(!r.ok, "无效存储布尔值应走 Err 通道");
    if (!r.ok) assert.ok(AppErrorOps.is(r.error, "PREFERENCES_INVALID_VALUE"));
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
      const r = await ctx.preferences.getLlmStreamEnabled();
      assert.ok(r.ok, "读取偏好应成功");
      if (r.ok) assert.equal(r.value, true);
    });
  });

  describe("v2 reset (C3)", () => {
    it("reset llmStream restores default true", async () => {
      const ctx = getNovelMasterTestContext();
      await ctx.preferences.setLlmStreamEnabled(false);
      const reset = await ctx.preferences.resetLlmStreamEnabled();
      assert.ok(reset.ok, "重置偏好应成功");
      const r = await ctx.preferences.getLlmStreamEnabled();
      assert.ok(r.ok, "读取偏好应成功");
      if (r.ok) assert.equal(r.value, true);
    });
  });

  describe("v2 round-trip", () => {
    it("llmStream boolean round-trip", async () => {
      const ctx = getNovelMasterTestContext();
      await ctx.preferences.setLlmStreamEnabled(false);
      const r = await ctx.preferences.getLlmStreamEnabled();
      assert.ok(r.ok, "读取偏好应成功");
      if (r.ok) assert.equal(r.value, false);
    });
  });

  describe("vfs.userVfsUnifiedToolTurn", () => {
    it("defaults to true when unset", async () => {
      const ctx = getNovelMasterTestContext();
      const r = await ctx.preferences.getUserVfsUnifiedToolTurn();
      assert.ok(r.ok, "读取偏好应成功");
      if (r.ok) assert.equal(r.value, true);
    });

    it("boolean round-trip and reset", async () => {
      const ctx = getNovelMasterTestContext();
      await ctx.preferences.setUserVfsUnifiedToolTurn(false);
      const off = await ctx.preferences.getUserVfsUnifiedToolTurn();
      assert.ok(off.ok, "读取偏好应成功");
      if (off.ok) assert.equal(off.value, false);
      const reset = await ctx.preferences.resetUserVfsUnifiedToolTurn();
      assert.ok(reset.ok, "重置偏好应成功");
      const r = await ctx.preferences.getUserVfsUnifiedToolTurn();
      assert.ok(r.ok, "读取偏好应成功");
      if (r.ok) assert.equal(r.value, true);
    });

    it("throws PreferencesError on invalid stored boolean", async () => {
      const ctx = getNovelMasterTestContext();
      const kkv = createKkvService(ctx.conn);
      await kkv.set("nm-preferences", "vfs.userVfsUnifiedToolTurn", "not-a-bool");
      const r = await ctx.preferences.getUserVfsUnifiedToolTurn();
      assert.ok(!r.ok, "无效存储布尔值应走 Err 通道");
      if (!r.ok) assert.ok(AppErrorOps.is(r.error, "PREFERENCES_INVALID_VALUE"));
    });
  });

  describe("chat.subagentStream", () => {
    it("T-P1: defaults to true when unset", async () => {
      const ctx = getNovelMasterTestContext();
      const r = await ctx.preferences.getSubagentStreamEnabled();
      assert.ok(r.ok, "读取偏好应成功");
      if (r.ok) assert.equal(r.value, true);
      await ctx.preferences.resetSubagentStreamEnabled();
    });

    it("T-P2: set/get round-trip（false 与 true 双向）", async () => {
      const ctx = getNovelMasterTestContext();
      await ctx.preferences.setSubagentStreamEnabled(false);
      const off = await ctx.preferences.getSubagentStreamEnabled();
      assert.ok(off.ok, "读取偏好应成功");
      if (off.ok) assert.equal(off.value, false);
      await ctx.preferences.setSubagentStreamEnabled(true);
      const on = await ctx.preferences.getSubagentStreamEnabled();
      assert.ok(on.ok, "读取偏好应成功");
      if (on.ok) assert.equal(on.value, true);
      await ctx.preferences.resetSubagentStreamEnabled();
    });

    it("T-P3: reset restores default true", async () => {
      const ctx = getNovelMasterTestContext();
      await ctx.preferences.setSubagentStreamEnabled(false);
      const off = await ctx.preferences.getSubagentStreamEnabled();
      assert.ok(off.ok, "读取偏好应成功");
      if (off.ok) assert.equal(off.value, false);
      const reset = await ctx.preferences.resetSubagentStreamEnabled();
      assert.ok(reset.ok, "重置偏好应成功");
      const r = await ctx.preferences.getSubagentStreamEnabled();
      assert.ok(r.ok, "读取偏好应成功");
      if (r.ok) assert.equal(r.value, true);
    });

    it("T-P4: throws PreferencesError on invalid stored boolean", async () => {
      const ctx = getNovelMasterTestContext();
      const kkv = createKkvService(ctx.conn);
      await kkv.set("nm-preferences", "chat.subagentStream", "not-a-bool");
      const r = await ctx.preferences.getSubagentStreamEnabled();
      assert.ok(!r.ok, "无效存储布尔值应走 Err 通道");
      if (!r.ok) assert.ok(AppErrorOps.is(r.error, "PREFERENCES_INVALID_VALUE"));
      // 清理：同库共享一条 in-memory DB，list 排序断言是全量 deepEqual，不能留脏值
      await ctx.preferences.resetSubagentStreamEnabled();
    });
  });

  describe("chat.thinkingContext", () => {
    it("defaults to false when unset", async () => {
      const ctx = getNovelMasterTestContext();
      const r = await ctx.preferences.getThinkingContextEnabled();
      assert.ok(r.ok, "读取偏好应成功");
      if (r.ok) assert.equal(r.value, false);
    });

    it("set true 后 get 为 true，reset 后回到 false", async () => {
      const ctx = getNovelMasterTestContext();
      await ctx.preferences.setThinkingContextEnabled(true);
      const on = await ctx.preferences.getThinkingContextEnabled();
      assert.ok(on.ok, "读取偏好应成功");
      if (on.ok) assert.equal(on.value, true);
      const reset = await ctx.preferences.resetThinkingContextEnabled();
      assert.ok(reset.ok, "重置偏好应成功");
      const r = await ctx.preferences.getThinkingContextEnabled();
      assert.ok(r.ok, "读取偏好应成功");
      if (r.ok) assert.equal(r.value, false);
    });

    it("throws PreferencesError on invalid stored boolean", async () => {
      const ctx = getNovelMasterTestContext();
      const kkv = createKkvService(ctx.conn);
      await kkv.set("nm-preferences", "chat.thinkingContext", "not-a-bool");
      const r = await ctx.preferences.getThinkingContextEnabled();
      assert.ok(!r.ok, "无效存储布尔值应走 Err 通道");
      if (!r.ok) assert.ok(AppErrorOps.is(r.error, "PREFERENCES_INVALID_VALUE"));
    });
  });
});
