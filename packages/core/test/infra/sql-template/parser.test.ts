import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  SqlTemplateError  } from "@/infra/sql-template/errors.js";
import {  SqlTemplateParse  } from "@/infra/sql-template/parser.js";

describe("parser", () => {
    it("builds AST for nested if", () => {
        const parsed = SqlTemplateParse.parseToAst(
            '<if test="a">X<if test="b">Y</if></if>',
        );
        assert.ok(parsed.ok);
        const ast = parsed.value;
        assert.equal(ast.length, 1);
        assert.equal(ast[0].type, "if");
        if (ast[0].type === "if") {
            assert.equal(ast[0].children.length, 2);
            assert.equal(ast[0].children[0].type, "text");
            assert.equal(ast[0].children[1].type, "if");
        }
    });

    it("rejects unknown tags with UNKNOWN_TAG and location", () => {
        const parsed = SqlTemplateParse.parseToAst("<unknown>x</unknown>");
        assert.ok(!parsed.ok);
        const err = parsed.error;
        assert.ok(err instanceof SqlTemplateError);
        assert.equal(err.code, "UNKNOWN_TAG");
        assert.equal(err.tagName, "unknown");
        assert.equal(typeof err.offset, "number");
    });

    it("rejects unclosed if with UNCLOSED_TAG", () => {
        const parsed = SqlTemplateParse.parseToAst('<if test="x">body');
        assert.ok(!parsed.ok);
        const err = parsed.error;
        assert.ok(err instanceof SqlTemplateError);
        assert.equal(err.code, "UNCLOSED_TAG");
    });

    it("preserves static comparison a < b as text", () => {
        const parsed = SqlTemplateParse.parseToAst("SELECT * FROM t WHERE a < b");
        assert.ok(parsed.ok);
        const ast = parsed.value;
        assert.equal(ast.length, 1);
        assert.equal(ast[0].type, "text");
        if (ast[0].type === "text") {
            assert.equal(ast[0].value, "SELECT * FROM t WHERE a < b");
        }
    });
});
