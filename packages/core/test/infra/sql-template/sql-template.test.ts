import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqlTemplateParser } from "../../../src/infra/sql-template/index.js";

describe("SqlTemplateParser e2e", () => {
  const parser = new SqlTemplateParser();

  it("#1 static SQL unchanged with empty parameters", () => {
    const sql = "SELECT * FROM user";
    const r = parser.parse(sql, { unused: true });
    assert.equal(r.sql, sql);
    assert.deepEqual(r.parameters, []);
  });

  it("#2 hash placeholder becomes ? with bound value", () => {
    const r = parser.parse("AND col = #{col}", { col: 10 });
    assert.ok(r.sql.includes("?"));
    assert.deepEqual(r.parameters, [10]);
  });

  it("#3 dollar placeholder embeds string without parameters", () => {
    const r = parser.parse("ORDER BY ${orderBy}", { orderBy: "id DESC" });
    assert.ok(r.sql.includes("id DESC"));
    assert.deepEqual(r.parameters, []);
  });

  it("#17 static text preserves a < b", () => {
    const r = parser.parse("SELECT * FROM t WHERE a < b", {});
    assert.equal(r.sql, "SELECT * FROM t WHERE a < b");
  });
});
