/**
 * Conformance test orchestrator: C1–C11 per TDBC spec.
 *
 * @module tdbc-conformance/suite
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  SqlTemplateParser,
  TdbcError,
  TdbcOpen,
  type TdbcConnection,
} from "@novel-master/core";
import { TdbcRegistry } from "@novel-master/core/tdbc";

export type ConformanceFactory = () => Promise<TdbcConnection>;

/** 各用例 `query<T>` 的行类型（类型别名只为让泛型调用一行写完）。 */
type ItemRow = { id: number; name: string };
type NullRow = { id: number; v: string | null };
type BlobRow = { id: number; data: Uint8Array };
type ParserRow = { id: number; label: string };

export interface ConformanceOptions {
  /** Factory used for C1–C10 (fresh connection per case where needed). */
  createConnection: ConformanceFactory;
  /** Clears drivers before C11 (unknown driver case). */
  beforeUnknownDriverTest?: () => void;
  /** Restores drivers after C11. */
  afterUnknownDriverTest?: () => void;
}

// nm-style 注记：文件名 suite 太泛，按内容主体起名（ConformanceSuite）。
/**
 * Registers conformance cases C1–C11 with node:test.
 */
export namespace ConformanceSuite {
  export function run(options: ConformanceOptions): void {
    const { createConnection } = options;

    describe("TDBC conformance", () => {
      describe("C1 lifecycle", () => {
        it("close then execute throws CONNECTION_CLOSED", async () => {
          const conn = await createConnection();
          await conn.close();
          await assert.rejects(
            () => conn.execute("SELECT 1"),
            (e: unknown) => {
              assert.ok(e instanceof TdbcError);
              assert.equal(e.code, "CONNECTION_CLOSED");
              return true;
            },
          );
        });
      });

      describe("C2 CRUD", () => {
        let conn: TdbcConnection;
        const CREATE_ITEMS_SQL = "CREATE TABLE IF NOT EXISTS conformance_items (id INTEGER PRIMARY KEY, name TEXT)";
        const INSERT_ITEM_SQL = "INSERT INTO conformance_items (id, name) VALUES (?, ?)";
        const SELECT_ITEM_BY_ID_SQL = "SELECT id, name FROM conformance_items WHERE id = ?";

        before(async () => {
          conn = await createConnection();
          await conn.execute(CREATE_ITEMS_SQL);
          await conn.execute("DELETE FROM conformance_items");
        });

        after(async () => {
          await conn.close();
        });

        it("INSERT and SELECT with ? bindings", async () => {
          await conn.execute(INSERT_ITEM_SQL, [1, "alpha"]);
          const rows = await conn.query<ItemRow>(SELECT_ITEM_BY_ID_SQL, [1]);
          assert.equal(rows.length, 1);
          assert.equal(rows[0]!.id, 1);
          assert.equal(rows[0]!.name, "alpha");
        });
      });

      describe("C3 null bindings", () => {
        let conn: TdbcConnection;
        const CREATE_NULLS_SQL = "CREATE TABLE IF NOT EXISTS conformance_nulls (id INTEGER PRIMARY KEY, v TEXT)";
        const INSERT_NULL_SQL = "INSERT INTO conformance_nulls (id, v) VALUES (?, ?)";
        const SELECT_NULLS_SQL = "SELECT id, v FROM conformance_nulls ORDER BY id";

        before(async () => {
          conn = await createConnection();
          await conn.execute(CREATE_NULLS_SQL);
          await conn.execute("DELETE FROM conformance_nulls");
        });

        after(async () => {
          await conn.close();
        });

        it("null and undefined bind as SQL NULL", async () => {
          await conn.execute(INSERT_NULL_SQL, [1, null]);
          await conn.execute(INSERT_NULL_SQL, [2, undefined]);
          const rows = await conn.query<NullRow>(SELECT_NULLS_SQL);
          assert.equal(rows[0]!.v, null);
          assert.equal(rows[1]!.v, null);
        });
      });

      describe("C4 BLOB", () => {
        let conn: TdbcConnection;
        const CREATE_BLOBS_SQL = "CREATE TABLE IF NOT EXISTS conformance_blobs (id INTEGER PRIMARY KEY, data BLOB)";
        const INSERT_BLOB_SQL = "INSERT INTO conformance_blobs (id, data) VALUES (?, ?)";
        const SELECT_BLOB_SQL = "SELECT id, data FROM conformance_blobs WHERE id = ?";

        before(async () => {
          conn = await createConnection();
          await conn.execute(CREATE_BLOBS_SQL);
          await conn.execute("DELETE FROM conformance_blobs");
        });

        after(async () => {
          await conn.close();
        });

        it("Uint8Array round-trips", async () => {
          const input = new Uint8Array([0, 255, 128, 1]);
          await conn.execute(INSERT_BLOB_SQL, [1, input]);
          const rows = await conn.query<BlobRow>(SELECT_BLOB_SQL, [1]);
          assert.ok(rows[0]!.data instanceof Uint8Array);
          assert.deepEqual([...rows[0]!.data], [...input]);
        });
      });

      describe("C5 transaction commit", () => {
        let conn: TdbcConnection;
        const CREATE_TX_SQL = "CREATE TABLE IF NOT EXISTS conformance_tx (id INTEGER PRIMARY KEY)";

        before(async () => {
          conn = await createConnection();
          await conn.execute(CREATE_TX_SQL);
          await conn.execute("DELETE FROM conformance_tx");
        });

        after(async () => {
          await conn.close();
        });

        it("committed changes are visible", async () => {
          await conn.transaction(async (tx) => {
            await tx.execute("INSERT INTO conformance_tx (id) VALUES (?)", [10]);
          });
          const rows = await conn.query("SELECT id FROM conformance_tx");
          assert.equal(rows.length, 1);
        });
      });

      describe("C6 transaction rollback", () => {
        let conn: TdbcConnection;
        const CREATE_TX_RB_SQL = "CREATE TABLE IF NOT EXISTS conformance_tx_rb (id INTEGER PRIMARY KEY)";
        const INSERT_TX_RB_SQL = "INSERT INTO conformance_tx_rb (id) VALUES (?)";

        before(async () => {
          conn = await createConnection();
          await conn.execute(CREATE_TX_RB_SQL);
          await conn.execute("DELETE FROM conformance_tx_rb");
          await conn.execute(INSERT_TX_RB_SQL, [1]);
        });

        after(async () => {
          await conn.close();
        });

        it("throw rolls back", async () => {
          await assert.rejects(async () => {
            await conn.transaction(async (tx) => {
              await tx.execute("INSERT INTO conformance_tx_rb (id) VALUES (?)", [
                2,
              ]);
              // nm-throw: keep — conformance 测试夹具：故意抛错验证事务回滚，非业务错误。
              throw new Error("rollback me");
            });
          });
          const rows = await conn.query("SELECT id FROM conformance_tx_rb");
          assert.equal(rows.length, 1);
        });
      });

      describe("C7 batch success", () => {
        let conn: TdbcConnection;
        const CREATE_BATCH_SQL = "CREATE TABLE IF NOT EXISTS conformance_batch (id INTEGER PRIMARY KEY, n INTEGER)";

        before(async () => {
          conn = await createConnection();
          await conn.execute(CREATE_BATCH_SQL);
          await conn.execute("DELETE FROM conformance_batch");
        });

        after(async () => {
          await conn.close();
        });

        it("batch inserts three rows", async () => {
          const result = await conn.batch(
            "INSERT INTO conformance_batch (id, n) VALUES (?, ?)",
            [
              [1, 10],
              [2, 20],
              [3, 30],
            ],
          );
          assert.equal(result.count, 3);
          assert.equal(result.totalChanges, 3);
          const rows = await conn.query("SELECT COUNT(*) AS c FROM conformance_batch");
          assert.equal((rows[0] as { c: number }).c, 3);
        });
      });

      describe("C8 batch failure", () => {
        let conn: TdbcConnection;
        const CREATE_BATCH_FAIL_SQL = "CREATE TABLE IF NOT EXISTS conformance_batch_fail (id INTEGER PRIMARY KEY)";
        const COUNT_BATCH_FAIL_SQL = "SELECT COUNT(*) AS c FROM conformance_batch_fail";

        before(async () => {
          conn = await createConnection();
          await conn.execute(CREATE_BATCH_FAIL_SQL);
          await conn.execute("DELETE FROM conformance_batch_fail");
        });

        after(async () => {
          await conn.close();
        });

        it("second row constraint violation rolls back all", async () => {
          await assert.rejects(
            () =>
              conn.batch("INSERT INTO conformance_batch_fail (id) VALUES (?)", [
                [1],
                [1],
                [2],
              ]),
            (e: unknown) => {
              assert.ok(e instanceof TdbcError);
              assert.equal(e.code, "BATCH_FAILED");
              return true;
            },
          );
          const rows = await conn.query(COUNT_BATCH_FAIL_SQL);
          assert.equal((rows[0] as { c: number }).c, 0);
        });
      });

      describe("C9 nested transaction", () => {
        let conn: TdbcConnection;

        before(async () => {
          conn = await createConnection();
        });

        after(async () => {
          await conn.close();
        });

        it("nested transaction throws NESTED_TRANSACTION", async () => {
          await assert.rejects(
            () =>
              conn.transaction(async (tx) => {
                await tx.transaction(async () => {});
              }),
            (e: unknown) => {
              assert.ok(e instanceof TdbcError);
              assert.equal(e.code, "NESTED_TRANSACTION");
              return true;
            },
          );
        });
      });

      describe("C10 SqlTemplateParser", () => {
        let conn: TdbcConnection;
        const parser = new SqlTemplateParser();
        const CREATE_PARSER_SQL = "CREATE TABLE IF NOT EXISTS conformance_parser (id INTEGER PRIMARY KEY, label TEXT)";
        const SELECT_PARSER_SQL = "SELECT id, label FROM conformance_parser WHERE id = ?";

        before(async () => {
          conn = await createConnection();
          await conn.execute(CREATE_PARSER_SQL);
          await conn.execute("DELETE FROM conformance_parser");
        });

        after(async () => {
          await conn.close();
        });

        it("executes parser INSERT output", async () => {
          const { sql, parameters } = parser.parse(
            "INSERT INTO conformance_parser (id, label) VALUES (#{id}, #{label})",
            { id: 5, label: "from-parser" },
          );
          assert.match(sql, /\?/);
          await conn.execute(sql, parameters);
          const rows = await conn.query<ParserRow>(SELECT_PARSER_SQL, [5]);
          assert.equal(rows[0]!.label, "from-parser");
        });
      });

      describe("C11 unknown driver", () => {
        it("open without registered driver throws UNKNOWN_DRIVER", async () => {
          TdbcRegistry.clear();
          options.beforeUnknownDriverTest?.();
          try {
            await assert.rejects(
              () => TdbcOpen.open("tdbc:sqlite:file::memory:"),
              (e: unknown) => {
                assert.ok(e instanceof TdbcError);
                assert.equal(e.code, "UNKNOWN_DRIVER");
                return true;
              },
            );
          } finally {
            options.afterUnknownDriverTest?.();
          }
        });
      });
    });
  }
}
