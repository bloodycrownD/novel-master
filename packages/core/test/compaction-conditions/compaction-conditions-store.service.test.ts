import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createCompactionConditionsStore,
  isCompactionConditionsError,
} from "@novel-master/core/compaction";
import { createKkvService } from "../../src/service/kkv/create-kkv-service.js";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

const MODULE = "nm-compaction-conditions";
const KEY = "policy";

describe("compaction conditions store integrity", () => {
  it("S1: empty database getConditions returns null", async () => {
    const ctx = await openNovelMasterTestConnection();
    const store = createCompactionConditionsStore(ctx.conn);
    assert.equal(await store.getConditions(), null);
    await ctx.conn.close();
  });

  it("S2: corrupt JSON throws INVALID_SCHEMA", async () => {
    const ctx = await openNovelMasterTestConnection();
    const kkv = createKkvService(ctx.conn);
    const store = createCompactionConditionsStore(ctx.conn);
    await kkv.set(MODULE, KEY, "{invalid json");
    await assert.rejects(
      () => store.getConditions(),
      (error: unknown) => isCompactionConditionsError(error, "INVALID_SCHEMA"),
    );
    await ctx.conn.close();
  });

  it("S3: enabled v3 without trigger throws on get", async () => {
    const ctx = await openNovelMasterTestConnection();
    const kkv = createKkvService(ctx.conn);
    const store = createCompactionConditionsStore(ctx.conn);
    await kkv.set(
      MODULE,
      KEY,
      JSON.stringify({ schemaVersion: 3, enabled: true }),
    );
    await assert.rejects(
      () => store.getConditions(),
      (error: unknown) => isCompactionConditionsError(error, "INVALID_SCHEMA"),
    );
    await ctx.conn.close();
  });

  it("S4: disabled v3 without trigger returns enabled false", async () => {
    const ctx = await openNovelMasterTestConnection();
    const kkv = createKkvService(ctx.conn);
    const store = createCompactionConditionsStore(ctx.conn);
    await kkv.set(
      MODULE,
      KEY,
      JSON.stringify({ schemaVersion: 3, enabled: false }),
    );
    const conditions = await store.getConditions();
    assert.equal(conditions?.enabled, false);
    await ctx.conn.close();
  });

  it("S5: setConditions invalid does not persist", async () => {
    const ctx = await openNovelMasterTestConnection();
    const store = createCompactionConditionsStore(ctx.conn);
    await assert.rejects(
      () =>
        store.setConditions({ schemaVersion: 3, enabled: true }),
      (error: unknown) => isCompactionConditionsError(error, "INVALID_SCHEMA"),
    );
    assert.equal(await store.getConditions(), null);
    await ctx.conn.close();
  });

  it("S6: setConditions round-trip", async () => {
    const ctx = await openNovelMasterTestConnection();
    const store = createCompactionConditionsStore(ctx.conn);
    const input = {
      schemaVersion: 3 as const,
      enabled: true,
      tokenRatio: 0.75,
      visibleFloor: 10,
    };
    await store.setConditions(input);
    const loaded = await store.getConditions();
    assert.deepEqual(loaded, input);
    await ctx.conn.close();
  });

  it("S7: v2 document migrates on read and writes v3", async () => {
    const ctx = await openNovelMasterTestConnection();
    const kkv = createKkvService(ctx.conn);
    const store = createCompactionConditionsStore(ctx.conn);
    await kkv.set(
      MODULE,
      KEY,
      JSON.stringify({
        schemaVersion: 2,
        enabled: true,
        tokenThreshold: 12000,
        visibleFloor: 20,
      }),
    );
    const first = await store.getConditions();
    assert.equal(first?.schemaVersion, 3);
    assert.equal(first?.tokenRatio, 0.8);
    assert.equal(first?.visibleFloor, 20);
    const raw = await kkv.get(MODULE, KEY);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(parsed.schemaVersion, 3);
    await ctx.conn.close();
  });
});
