/**
 * Cross-driver parity suite: nested batch SAVEPOINT semantics (A-24).
 *
 * A `batch()` invoked inside an outer `transaction()` must be scoped to a
 * SAVEPOINT. On batch failure only the batch is rolled back; the outer
 * transaction stays open and committable. An uncaught batch error still
 * propagates and rolls back the whole outer transaction.
 *
 * @module tdbc-conformance/nested-batch
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { TdbcError, type TdbcConnection } from "@novel-master/core";

export type NestedBatchFactory = () => Promise<TdbcConnection>;

export interface NestedBatchOptions {
  /** Fresh connection used per describe block. */
  createConnection: NestedBatchFactory;
}

/**
 * Registers nested-batch parity cases NB1–NB3 with node:test.
 */
export function runNestedBatchParityTests(
  options: NestedBatchOptions,
): void {
  const { createConnection } = options;

  describe("nested batch parity (SAVEPOINT semantics)", () => {
    describe("NB1 batch success inside transaction", () => {
      let conn: TdbcConnection;

      before(async () => {
        conn = await createConnection();
        await conn.execute(
          "CREATE TABLE IF NOT EXISTS nb_parity (id INTEGER PRIMARY KEY, label TEXT)",
        );
        await conn.execute("DELETE FROM nb_parity");
      });

      after(async () => {
        await conn.close();
      });

      it("batch writes commit together with the outer transaction", async () => {
        await conn.transaction(async (tx) => {
          await tx.execute(
            "INSERT INTO nb_parity (id, label) VALUES (?, ?)",
            [1, "solo"],
          );
          const batch = await tx.batch(
            "INSERT INTO nb_parity (id, label) VALUES (?, ?)",
            [
              [2, "a"],
              [3, "b"],
            ],
          );
          assert.equal(batch.count, 2);
          assert.equal(batch.totalChanges, 2);
        });

        const rows = await conn.query<{ id: number; label: string }>(
          "SELECT label FROM nb_parity ORDER BY id",
        );
        assert.deepEqual(
          rows.map((r) => r.label),
          ["solo", "a", "b"],
        );
      });
    });

    describe("NB2 batch failure scopes to savepoint only", () => {
      let conn: TdbcConnection;

      before(async () => {
        conn = await createConnection();
        await conn.execute(
          "CREATE TABLE IF NOT EXISTS nb_parity_fail (id INTEGER PRIMARY KEY, label TEXT)",
        );
        await conn.execute("DELETE FROM nb_parity_fail");
      });

      after(async () => {
        await conn.close();
      });

      it("caught batch error leaves outer writes intact and committable", async () => {
        await conn.transaction(async (tx) => {
          await tx.execute(
            "INSERT INTO nb_parity_fail (id, label) VALUES (?, ?)",
            [1, "keep"],
          );

          // Second row hits the PK conflict → BATCH_FAILED, rolled back to
          // the batch's savepoint only.
          await assert.rejects(
            () =>
              tx.batch(
                "INSERT INTO nb_parity_fail (id, label) VALUES (?, ?)",
                [
                  [2, "ok"],
                  [1, "dup"],
                ],
              ),
            (e: unknown) => {
              assert.ok(e instanceof TdbcError);
              assert.equal(e.code, "BATCH_FAILED");
              return true;
            },
          );

          // Outer transaction is still alive: a subsequent write survives.
          await tx.execute(
            "INSERT INTO nb_parity_fail (id, label) VALUES (?, ?)",
            [3, "after"],
          );
        });

        const rows = await conn.query<{ id: number; label: string }>(
          "SELECT label FROM nb_parity_fail ORDER BY id",
        );
        assert.deepEqual(
          rows.map((r) => r.label),
          ["keep", "after"],
        );
      });
    });

    describe("NB3 uncaught batch failure rolls back whole transaction", () => {
      let conn: TdbcConnection;

      before(async () => {
        conn = await createConnection();
        await conn.execute(
          "CREATE TABLE IF NOT EXISTS nb_parity_uncaught (id INTEGER PRIMARY KEY)",
        );
        await conn.execute("DELETE FROM nb_parity_uncaught");
      });

      after(async () => {
        await conn.close();
      });

      it("propagated batch error rolls back the outer transaction", async () => {
        await assert.rejects(
          () =>
            conn.transaction(async (tx) => {
              await tx.execute(
                "INSERT INTO nb_parity_uncaught (id) VALUES (?)",
                [1],
              );
              await tx.batch(
                "INSERT INTO nb_parity_uncaught (id) VALUES (?)",
                [[2], [1]],
              );
            }),
          (e: unknown) => {
            assert.ok(e instanceof TdbcError);
            return true;
          },
        );

        const rows = await conn.query<{ id: number }>(
          "SELECT id FROM nb_parity_uncaught",
        );
        assert.equal(rows.length, 0);
      });
    });
  });
}
