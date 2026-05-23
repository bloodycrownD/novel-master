import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqlTemplateParser } from "../../../src/infra/sql-template/index.js";
import type { TdbcConnection } from "../../../src/infra/tdbc/connection.js";
import {
  executeTemplate,
  queryTemplate,
} from "../../../src/infra/tdbc/template-helper.js";

describe("template-helper", () => {
  const parser = new SqlTemplateParser();

  it("executeTemplate forwards parse result", async () => {
    let capturedSql = "";
    let capturedParams: readonly unknown[] | undefined;
    const connection: TdbcConnection = {
      execute: async (sql, parameters) => {
        capturedSql = sql;
        capturedParams = parameters;
        return { changes: 1, lastInsertRowid: 42 };
      },
      query: async () => [],
      batch: async () => ({ totalChanges: 0, count: 0 }),
      transaction: async (fn) => fn(connection),
      close: async () => {},
    };

    const result = await executeTemplate(
      connection,
      parser,
      "INSERT INTO t (a) VALUES (#{a})",
      { a: 7 },
    );

    assert.equal(result.changes, 1);
    assert.match(capturedSql, /INSERT INTO t/);
    assert.deepEqual(capturedParams, [7]);
  });

  it("queryTemplate forwards parse result", async () => {
    const connection: TdbcConnection = {
      execute: async () => ({ changes: 0, lastInsertRowid: 0 }),
      query: async (sql, parameters) => {
        assert.match(sql, /SELECT/);
        assert.deepEqual(parameters, [1]);
        return [{ id: 1 }];
      },
      batch: async () => ({ totalChanges: 0, count: 0 }),
      transaction: async (fn) => fn(connection),
      close: async () => {},
    };

    const rows = await queryTemplate(
      connection,
      parser,
      "SELECT * FROM t WHERE id = #{id}",
      { id: 1 },
    );
    assert.deepEqual(rows, [{ id: 1 }]);
  });
});
