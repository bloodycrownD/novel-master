import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
    NovelMasterBootstrap,
    TdbcOpen,
} from "@novel-master/core";
import {
    BETTER_SQLITE3_DRIVER_NAME,
    BetterSqlite3Register,
} from "@novel-master/tdbc-driver-better-sqlite3";
import { Dpapi } from "../src/dpapi.js";
import { WindowsSecretStore } from "../src/sqlite-secret-store.js";

describe("SqliteSecretStore", () => {
    before(() => {
        Dpapi.setTestPassthrough(true);
        BetterSqlite3Register.register();
    });

    after(() => {
        Dpapi.setTestPassthrough(false);
    });

    it("round-trips set/get and stores non-plaintext ciphertext", async () => {
        const conn = await TdbcOpen.open("tdbc:sqlite:file::memory:", {
            driver: BETTER_SQLITE3_DRIVER_NAME,
            filename: ":memory:",
        });
        await NovelMasterBootstrap.bootstrap(conn);
        const store = WindowsSecretStore.create(conn);
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
