import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqlTemplateParser } from "../../../src/infra/sql-template/index.js";

describe("evaluator trim / choose", () => {
  const parser = new SqlTemplateParser();

  it("#10 trim removes prefixOverrides token", () => {
    const r = parser.parse(
      '<trim prefix="WHERE " prefixOverrides="AND">AND col = 1</trim>',
      {},
    );
    assert.ok(r.sql.includes("WHERE col = 1"));
    assert.ok(!r.sql.includes("AND col"));
  });

  it("#11 choose picks first matching when", () => {
    const r = parser.parse(
      "<choose>" +
        '<when test="false">A</when>' +
        '<when test="true">B</when>' +
        '<when test="true">C</when>' +
        "</choose>",
      {},
    );
    assert.equal(r.sql.trim(), "B");
  });

  it("#12 choose falls back to otherwise", () => {
    const r = parser.parse(
      "<choose>" +
        '<when test="false">A</when>' +
        "<otherwise>D</otherwise>" +
        "</choose>",
      {},
    );
    assert.equal(r.sql.trim(), "D");
  });
});
