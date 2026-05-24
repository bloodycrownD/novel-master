import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  bootstrapNovelMaster,
  open,
} from "@novel-master/core";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import { setDpapiTestPassthrough } from "../src/dpapi.js";
import { createWindowsSecretStore } from "../src/sqlite-secret-store.js";

describe("SqliteSecretStore", () => {
  before(() => {
    setDpapiTestPassthrough(true);
    registerBetterSqlite3Driver();
  });

  after(() => {
    setDpapiTestPassthrough(false);
  });

  it("round-trips set/get and stores non-plaintext ciphertext", async () => {
    const conn = await open("tdbc:sqlite:file::memory:", {
      driver: BETTER_SQLITE3_DRIVER_NAME,
      filename: ":memory:",
    });
    await bootstrapNovelMaster(conn);
    const store = createWindowsSecretStore(conn);
    const ref = "provider/test/apiKey";
    await store.set(ref, "sk-secret-123");
    assert.equal(await store.get(ref), "sk-secret-123");
    assert.equal(await store.has(ref), true);

    const rows = await conn.query<{ algo: string }>(
      "SELECT algo FROM sksp_secrets WHERE ref = ?",
      [ref],
    );
    assert.equal(rows[0]!.algo, "dpapi-v1");

    await store.delete(ref);
    assert.equal(await store.get(ref), null);
    await conn.close();
  });
});
