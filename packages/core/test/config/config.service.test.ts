import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConfigError } from "@novel-master/core";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

describe("ConfigService", () => {
  it("sets and gets string values", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.config.set("key1", "value1");
    assert.equal(await ctx.config.get("key1"), "value1");
    await ctx.conn.close();
  });

  it("returns undefined for missing keys", async () => {
    const ctx = await openNovelMasterTestConnection();
    assert.equal(await ctx.config.get("missing"), undefined);
    await ctx.conn.close();
  });

  it("sets and gets boolean values", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.config.setBoolean("flag", true);
    assert.equal(await ctx.config.getBoolean("flag"), true);
    await ctx.config.setBoolean("flag", false);
    assert.equal(await ctx.config.getBoolean("flag"), false);
    await ctx.conn.close();
  });

  it("uses default value for missing boolean", async () => {
    const ctx = await openNovelMasterTestConnection();
    assert.equal(await ctx.config.getBoolean("missing", true), true);
    assert.equal(await ctx.config.getBoolean("missing", false), false);
    await ctx.conn.close();
  });

  it("throws on invalid boolean value", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.config.set("bad", "not-a-bool");
    await assert.rejects(
      () => ctx.config.getBoolean("bad"),
      (e: unknown) => e instanceof ConfigError && e.code === "INVALID_TYPE",
    );
    await ctx.conn.close();
  });

  it("sets and gets number values", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.config.setNumber("count", 42);
    assert.equal(await ctx.config.getNumber("count"), 42);
    await ctx.config.setNumber("count", 0);
    assert.equal(await ctx.config.getNumber("count"), 0);
    await ctx.conn.close();
  });

  it("uses default value for missing number", async () => {
    const ctx = await openNovelMasterTestConnection();
    assert.equal(await ctx.config.getNumber("missing", 99), 99);
    assert.equal(await ctx.config.getNumber("missing", 0), 0);
    await ctx.conn.close();
  });

  it("throws on invalid number value", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.config.set("bad", "not-a-number");
    await assert.rejects(
      () => ctx.config.getNumber("bad"),
      (e: unknown) => e instanceof ConfigError && e.code === "INVALID_TYPE",
    );
    await ctx.conn.close();
  });

  it("lists all config entries", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.config.set("a", "1");
    await ctx.config.set("b", "2");
    const list = await ctx.config.list();
    assert.deepEqual(
      list.sort((x, y) => x.key.localeCompare(y.key)),
      [
        { key: "a", value: "1" },
        { key: "b", value: "2" },
      ],
    );
    await ctx.conn.close();
  });

  it("resets a config key", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.config.set("temp", "value");
    await ctx.config.reset("temp");
    assert.equal(await ctx.config.get("temp"), undefined);
    await ctx.conn.close();
  });

  it("reset is idempotent (no error on missing key)", async () => {
    const ctx = await openNovelMasterTestConnection();
    await ctx.config.reset("never-existed");
    await ctx.conn.close();
  });
});
