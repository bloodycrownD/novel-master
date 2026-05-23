import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqlTemplateError } from "../../../src/infra/sql-template/errors.js";
import { parseTemplateToAst } from "../../../src/infra/sql-template/parser.js";

describe("parser", () => {
  it("builds AST for nested if", () => {
    const ast = parseTemplateToAst(
      '<if test="a">X<if test="b">Y</if></if>',
    );
    assert.equal(ast.length, 1);
    assert.equal(ast[0].type, "if");
    if (ast[0].type === "if") {
      assert.equal(ast[0].children.length, 2);
      assert.equal(ast[0].children[0].type, "text");
      assert.equal(ast[0].children[1].type, "if");
    }
  });

  it("throws UNKNOWN_TAG for unknown tags", () => {
    assert.throws(
      () => parseTemplateToAst("<unknown>x</unknown>"),
      (err: unknown) => {
        assert.ok(err instanceof SqlTemplateError);
        assert.equal(err.code, "UNKNOWN_TAG");
        assert.equal(err.tagName, "unknown");
        assert.equal(typeof err.offset, "number");
        return true;
      },
    );
  });

  it("throws UNCLOSED_TAG for unclosed if", () => {
    assert.throws(
      () => parseTemplateToAst('<if test="x">body'),
      (err: unknown) => {
        assert.ok(err instanceof SqlTemplateError);
        assert.equal(err.code, "UNCLOSED_TAG");
        return true;
      },
    );
  });

  it("preserves static comparison a < b as text", () => {
    const ast = parseTemplateToAst("SELECT * FROM t WHERE a < b");
    assert.equal(ast.length, 1);
    assert.equal(ast[0].type, "text");
    if (ast[0].type === "text") {
      assert.equal(ast[0].value, "SELECT * FROM t WHERE a < b");
    }
  });
});
