import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PreferencesError } from "@novel-master/core";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";
import { createKkvService } from "../../src/service/kkv/create-kkv-service.js";
import {
  PREF_KEY_CHAT_LLM_STREAM,
  PREF_KEY_CHAT_SHOW_FULL_TOOL_PARAMS,
  PREF_KEY_SESSION_FS_CHECKPOINT_RETENTION,
} from "../../src/service/persistent-preferences/impl/preference-keys.js";

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

    it("showFullToolParams defaults to false when unset", async () => {
      const ctx = await openNovelMasterTestConnection();
      assert.equal(await ctx.preferences.getShowFullToolParams(), false);
      await ctx.conn.close();
    });

    it("checkpointRetention defaults to 100 when unset", async () => {
      const ctx = await openNovelMasterTestConnection();
      assert.equal(await ctx.preferences.getCheckpointRetention(), 100);
      await ctx.conn.close();
    });
  });

  describe("v2 retention validation (C2)", () => {
    it("accepts boundary values 1 and 9999", async () => {
      const ctx = await openNovelMasterTestConnection();
      await ctx.preferences.setCheckpointRetention(1);
      assert.equal(await ctx.preferences.getCheckpointRetention(), 1);
      await ctx.preferences.setCheckpointRetention(9999);
      assert.equal(await ctx.preferences.getCheckpointRetention(), 9999);
      await ctx.conn.close();
    });

    it("rejects 0, 10000, and non-numeric on set", async () => {
      const ctx = await openNovelMasterTestConnection();
      for (const bad of [0, 10000, 1.5, NaN]) {
        await assert.rejects(
          () => ctx.preferences.setCheckpointRetention(bad),
          (e: unknown) => e instanceof PreferencesError && e.code === "INVALID_VALUE",
        );
      }
      await ctx.conn.close();
    });

    it("rejects invalid stored retention on get", async () => {
      const ctx = await openNovelMasterTestConnection();
      const kkv = createKkvService(ctx.conn);
      for (const bad of ["0", "10000", "abc"]) {
        await kkv.set(
          "nm-preferences",
          PREF_KEY_SESSION_FS_CHECKPOINT_RETENTION,
          bad,
        );
        await assert.rejects(
          () => ctx.preferences.getCheckpointRetention(),
          (e: unknown) =>
            e instanceof PreferencesError && e.code === "INVALID_VALUE",
        );
      }
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

    it("reset showFullToolParams restores default false", async () => {
      const ctx = await openNovelMasterTestConnection();
      await ctx.preferences.setShowFullToolParams(true);
      await ctx.preferences.resetShowFullToolParams();
      assert.equal(await ctx.preferences.getShowFullToolParams(), false);
      await ctx.conn.close();
    });

    it("reset checkpointRetention restores default 100", async () => {
      const ctx = await openNovelMasterTestConnection();
      await ctx.preferences.setCheckpointRetention(50);
      await ctx.preferences.resetCheckpointRetention();
      assert.equal(await ctx.preferences.getCheckpointRetention(), 100);
      await ctx.conn.close();
    });
  });

  describe("v2 round-trip", () => {
    it("boolean prefs round-trip", async () => {
      const ctx = await openNovelMasterTestConnection();
      await ctx.preferences.setLlmStreamEnabled(false);
      assert.equal(await ctx.preferences.getLlmStreamEnabled(), false);
      await ctx.preferences.setShowFullToolParams(true);
      assert.equal(await ctx.preferences.getShowFullToolParams(), true);
      await ctx.conn.close();
    });
  });
});
