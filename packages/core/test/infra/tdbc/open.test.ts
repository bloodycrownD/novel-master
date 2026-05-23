import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { TdbcError } from "../../../src/infra/tdbc/errors.js";
import { open, parseUrl } from "../../../src/infra/tdbc/open.js";
import {
  clearDrivers,
  registerDriver,
} from "../../../src/infra/tdbc/registry.js";
import type { TdbcConnection } from "../../../src/infra/tdbc/connection.js";
import type { TdbcDriver } from "../../../src/infra/tdbc/driver.js";

function mockDriver(name: string, connection: TdbcConnection): TdbcDriver {
  return {
    name,
    open: async () => connection,
  };
}

describe("parseUrl", () => {
  it("parses file path", () => {
    assert.deepEqual(parseUrl("tdbc:sqlite:./data/app.db"), {
      filename: "./data/app.db",
    });
  });

  it("parses memory URL", () => {
    assert.deepEqual(parseUrl("tdbc:sqlite:file::memory:"), {
      filename: ":memory:",
    });
  });

  it("rejects invalid scheme", () => {
    assert.throws(() => parseUrl("http:sqlite:x"), (e: unknown) => {
      assert.ok(e instanceof TdbcError);
      assert.equal(e.code, "INVALID_URL");
      return true;
    });
  });
});

describe("open", () => {
  beforeEach(() => clearDrivers());

  it("throws UNKNOWN_DRIVER when none registered", async () => {
    await assert.rejects(
      () => open("tdbc:sqlite:file::memory:"),
      (e: unknown) => {
        assert.ok(e instanceof TdbcError);
        assert.equal(e.code, "UNKNOWN_DRIVER");
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
    registerDriver(mockDriver("better-sqlite3", conn));
    registerDriver(mockDriver("rn", conn));

    const c = await open("tdbc:sqlite:file::memory:", {
      driver: "better-sqlite3",
    });
    await c.close();
    assert.equal(closed.closed, true);
  });
});
