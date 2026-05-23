/**
 * RN driver: batch inside {@link TdbcConnection.transaction} must not nest BEGIN/COMMIT.
 *
 * @module tdbc-driver-rn/test/transaction-batch
 */

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import type { TdbcConnection } from "@novel-master/core";
import { RnDriver, RN_DRIVER_NAME } from "../src/driver.js";
import { MockRnSqliteAdapter } from "./mock-adapter.js";

const driver = new RnDriver(new MockRnSqliteAdapter());

describe("transaction + tx.batch", () => {
  let conn: TdbcConnection;

  before(async () => {
    conn = await driver.open({ filename: ":memory:", driver: RN_DRIVER_NAME });
    await conn.execute(
      "CREATE TABLE tx_batch (id INTEGER PRIMARY KEY, label TEXT)",
    );
    await conn.execute("DELETE FROM tx_batch");
  });

  after(async () => {
    await conn.close();
  });

  it("commits batch rows atomically with the outer transaction", async () => {
    await conn.transaction(async (tx) => {
      await tx.execute("INSERT INTO tx_batch (id, label) VALUES (?, ?)", [
        1,
        "solo",
      ]);
      const batch = await tx.batch(
        "INSERT INTO tx_batch (id, label) VALUES (?, ?)",
        [
          [2, "a"],
          [3, "b"],
        ],
      );
      assert.equal(batch.count, 2);
      assert.equal(batch.totalChanges, 2);
    });

    const rows = await conn.query<{ id: number; label: string }>(
      "SELECT id, label FROM tx_batch ORDER BY id",
    );
    assert.deepEqual(
      rows.map((r) => r.label),
      ["solo", "a", "b"],
    );
  });

  it("rolls back batch failure with the outer transaction", async () => {
    await conn.execute("DELETE FROM tx_batch");

    await assert.rejects(
      () =>
        conn.transaction(async (tx) => {
          await tx.execute("INSERT INTO tx_batch (id, label) VALUES (?, ?)", [
            10,
            "keep",
          ]);
          await tx.batch("INSERT INTO tx_batch (id, label) VALUES (?, ?)", [
            [11, "ok"],
            [10, "dup"],
          ]);
        }),
      (e: unknown) => {
        assert.ok(e instanceof Error);
        return true;
      },
    );

    const rows = await conn.query<{ id: number }>(
      "SELECT id FROM tx_batch ORDER BY id",
    );
    assert.deepEqual(rows, []);
  });
});
