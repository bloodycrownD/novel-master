import assert from "node:assert/strict";
import {  describe, it, beforeEach  } from "node:test";
import {  AssertionError  } from "@/common/assert.js";
import {  TdbcError  } from "@/infra/tdbc/errors.js";
import {  TdbcOpen  } from "@/infra/tdbc/logic/open.js";
import {  TdbcRegistry  } from "@/infra/tdbc/logic/registry.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { TdbcDriver } from "@/infra/tdbc/ports/driver.port.js";

function mockDriver(name: string, connection: TdbcConnection): TdbcDriver {
    return {
        name,
        open: async () => connection,
    };
}

describe("parseUrl", () => {
    it("parses file path", () => {
        const parsed = TdbcOpen.parseUrl("tdbc:sqlite:./data/app.db");
        if (!parsed.ok) assert.fail(parsed.error.message);
        assert.deepEqual(parsed.value, {
            filename: "./data/app.db",
        });
    });

    it("parses memory URL", () => {
        const parsed = TdbcOpen.parseUrl("tdbc:sqlite:file::memory:");
        if (!parsed.ok) assert.fail(parsed.error.message);
        assert.deepEqual(parsed.value, {
            filename: ":memory:",
        });
    });

    it("rejects invalid scheme", () => {
        const parsed = TdbcOpen.parseUrl("http:sqlite:x");
        if (parsed.ok) assert.fail(`expected invalid URL, got ${JSON.stringify(parsed.value)}`);
        assert.ok(parsed.error instanceof TdbcError);
        assert.equal(parsed.error.code, "INVALID_URL");
    });
});

describe("open", () => {
    beforeEach(() => TdbcRegistry.clear());

    it("throws AssertionError when none registered", async () => {
        await assert.rejects(
            () => TdbcOpen.open("tdbc:sqlite:file::memory:"),
            (e: unknown) => {
                assert.ok(e instanceof AssertionError);
                assert.ok(e.message.includes("TDBC: no driver registered"));
                return true;
            },
        );
    });

    it("uses explicit driver option", async () => {
        const closed = { closed: false };
        const conn: TdbcConnection = {
            execute: async () => ({ changes: 0, lastInsertRowid: 0 }),
            query: async () => [],
            batch: async () => ({ totalChanges: 0, count: 0 }),
            transaction: async (fn) => fn(conn),
            close: async () => {
                closed.closed = true;
            },
        };
        TdbcRegistry.register(mockDriver("better-sqlite3", conn));
        TdbcRegistry.register(mockDriver("rn", conn));

        const c = await TdbcOpen.open("tdbc:sqlite:file::memory:", {
            driver: "better-sqlite3",
        });
        await c.close();
        assert.equal(closed.closed, true);
    });
});
