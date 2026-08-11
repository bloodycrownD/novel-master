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
import {
  resolveSkspDriver,
  SkspError,
} from "@novel-master/core/sksp";
import { setLinuxKeychainTestPassthrough } from "../src/keychain.js";
import { createLinuxSecretStore } from "../src/sqlite-secret-store.js";
import { registerSkspLinuxDriver } from "../src/register.js";

describe("LinuxSqliteSecretStore", () => {
  before(() => {
    setLinuxKeychainTestPassthrough(true);
    registerBetterSqlite3Driver();
  });

  after(() => {
    setLinuxKeychainTestPassthrough(false);
  });

  it("round-trips set/get and stores non-plaintext ciphertext with iv", async () => {
    const conn = await open("tdbc:sqlite:file::memory:", {
      driver: BETTER_SQLITE3_DRIVER_NAME,
      filename: ":memory:",
    });
    await bootstrapNovelMaster(conn);
    const store = createLinuxSecretStore(conn);
    const ref = "provider/test/apiKey";
    const plain = "sk-secret-123";
    await store.set(ref, plain);
    assert.equal(await store.get(ref), plain);
    assert.equal(await store.has(ref), true);

    const rows = await conn.query<{
      algo: string;
      iv: Uint8Array | null;
      ciphertext: Uint8Array;
    }>("SELECT algo, iv, ciphertext FROM sksp_secrets WHERE ref = ?", [ref]);
    assert.equal(rows[0]!.algo, "linux-secret-service-aes-gcm-v1");
    assert.notEqual(rows[0]!.iv, null);
    assert.notEqual(
      Buffer.from(rows[0]!.ciphertext).toString("utf8"),
      plain,
    );

    assert.equal(await store.delete(ref), true);
    assert.equal(await store.get(ref), null);
    await conn.close();
  });

  it("rejects rows with unsupported algo", async () => {
    const conn = await open("tdbc:sqlite:file::memory:", {
      driver: BETTER_SQLITE3_DRIVER_NAME,
      filename: ":memory:",
    });
    await bootstrapNovelMaster(conn);
    const store = createLinuxSecretStore(conn);
    const ref = "provider/wrong/algo";
    await conn.execute(
      `INSERT INTO sksp_secrets (ref, ciphertext, iv, algo, version, updated_at_ms)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [ref, Buffer.from("x"), Buffer.alloc(12), "dpapi-v1", Date.now()],
    );
    await assert.rejects(
      () => store.get(ref),
      (err: unknown) => {
        assert.ok(err instanceof SkspError);
        assert.equal(err.code, "DECRYPT_FAILED");
        return true;
      },
    );
    await conn.close();
  });

  it("registers and resolves linux driver", () => {
    registerSkspLinuxDriver();
    const driver = resolveSkspDriver("linux");
    assert.equal(driver.name, "linux");
    assert.equal(typeof driver.createStore, "function");
  });
});
