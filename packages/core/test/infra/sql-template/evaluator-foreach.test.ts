import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";

describe("evaluator foreach", () => {
  const parser = new SqlTemplateParser();

  const template =
    'SELECT * FROM t WHERE id IN <foreach collection="ids" item="id" open="(" separator="," close=")">#{id}</foreach>';

  it("#8 expands collection with placeholders", () => {
    const r = parser.parse(template, { ids: [1, 2, 3] });
    assert.ok(r.sql.includes("WHERE id IN (?,?,?)"));
    assert.deepEqual(r.parameters, [1, 2, 3]);
  });

  it("#9 empty array omits foreach fragment", () => {
    const r = parser.parse(template, { ids: [] });
    assert.ok(!r.sql.includes("IN ()"));
    assert.equal(r.parameters.length, 0);
  });

  it("#9 null collection omits foreach fragment", () => {
    const r = parser.parse(template, { ids: null });
    assert.ok(!r.sql.includes("("));
    assert.equal(r.parameters.length, 0);
  });

  it("#16 nested foreach preserves parameter order", () => {
    const nested =
      '<foreach collection="rows" item="row" open="[" separator="," close="]">' +
      '<foreach collection="row.items" item="item" open="(" separator="," close=")">#{item}</foreach>' +
      "</foreach>";
    const r = parser.parse(nested, {
      rows: [{ items: [1, 2] }, { items: [3] }],
    });
    assert.deepEqual(r.parameters, [1, 2, 3]);
  });
});
