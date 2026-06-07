import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PreferencesError } from "@novel-master/core";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";
import { createKkvService } from "../../src/service/kkv/create-kkv-service.js";

describe("PersistentPreferences", () => {
  it("versionCheck defaults to true when unset", async () => {
    const ctx = await openNovelMasterTestConnection();
    assert.equal(await ctx.preferences.getSessionFsVersionCheck(), true);
    await ctx.conn.close();
  });

  it("set false / true round-trips", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.preferences.setSessionFsVersionCheck(false);
    assert.equal(await ctx.preferences.getSessionFsVersionCheck(), false);
    await ctx.preferences.setSessionFsVersionCheck(true);
    assert.equal(await ctx.preferences.getSessionFsVersionCheck(), true);
    await ctx.conn.close();
  });

  it("reset restores default true", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.preferences.setSessionFsVersionCheck(false);
    await ctx.preferences.resetSessionFsVersionCheck();
    assert.equal(await ctx.preferences.getSessionFsVersionCheck(), true);
    await ctx.conn.close();
  });

  it("throws PreferencesError on invalid stored boolean", async () => {
    const ctx = await openNovelMasterTestConnection();
    const kkv = createKkvService(ctx.conn);
    await kkv.set("nm-preferences", "session-fs.versionCheck", "not-a-bool");
    await assert.rejects(
      () => ctx.preferences.getSessionFsVersionCheck(),
      (e: unknown) => e instanceof PreferencesError && e.code === "INVALID_VALUE",
    );
    await ctx.conn.close();
  });

  it("lists preference entries sorted by key", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.preferences.setSessionFsVersionCheck(false);
    const list = await ctx.preferences.list();
    assert.deepEqual(list, [{ key: "session-fs.versionCheck", value: "false" }]);
    await ctx.conn.close();
  });

  describe("v2 defaults (C1)", () => {
    it("llmStream defaults to true when unset", async () => {
      const ctx = await openNovelMasterTestConnection();
      assert.equal(await ctx.preferences.getLlmStreamEnabled(), true);
      await ctx.conn.close();
    });
  });

  describe("v2 reset (C3)", () => {
    it("reset llmStream restores default true", async () => {
      const ctx = await openNovelMasterTestConnection();
      await ctx.preferences.setLlmStreamEnabled(false);
      await ctx.preferences.resetLlmStreamEnabled();
      assert.equal(await ctx.preferences.getLlmStreamEnabled(), true);
      await ctx.conn.close();
    });
  });

  describe("v2 round-trip", () => {
    it("llmStream boolean round-trip", async () => {
      const ctx = await openNovelMasterTestConnection();
      await ctx.preferences.setLlmStreamEnabled(false);
      assert.equal(await ctx.preferences.getLlmStreamEnabled(), false);
      await ctx.conn.close();
    });
  });
});
