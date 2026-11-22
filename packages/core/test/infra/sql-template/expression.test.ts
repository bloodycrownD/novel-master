import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  SqlTemplateExpression  } from "@/infra/sql-template/expression.js";
import {  SqlTemplateError  } from "@/infra/sql-template/errors.js";

describe("expression", () => {
    it("normalizes MyBatis and/or/not", () => {
        assert.equal(
            SqlTemplateExpression.normalize("a and b or not c"),
            "a && b || ! c",
        );
    });

    it("evaluates and / != null with undefined properties", () => {
        const stack = [{ enabled: true, name: "" }];
        assert.equal(SqlTemplateExpression.evaluateTest("enabled", stack), true);
        assert.equal(SqlTemplateExpression.evaluateTest("missing != null", stack), false);
        assert.equal(
            SqlTemplateExpression.evaluateTest("name != null and name != ''", stack),
            false,
        );
    });

    it("does not rewrite and/or/not inside string literals", () => {
        assert.equal(
            SqlTemplateExpression.normalize("name == 'and'"),
            "name == 'and'",
        );
        assert.equal(
            SqlTemplateExpression.normalize('status == "or"'),
            'status == "or"',
        );
        assert.equal(
            SqlTemplateExpression.bindToContext("type == 'not'"),
            "__ctx__.type == 'not'",
        );
    });

    it("evaluates comparisons against literal and/or", () => {
        const stack = [{ name: "and", status: "or" }];
        assert.equal(SqlTemplateExpression.evaluateTest("name == 'and'", stack), true);
        assert.equal(SqlTemplateExpression.evaluateTest('status == "or"', stack), true);
        assert.equal(SqlTemplateExpression.evaluateTest("name == 'or'", stack), false);
    });

    it("rejects constructor sandbox escape vectors", () => {
        const stack = [{}];
        for (const expr of [
            "(0).constructor.constructor('return globalThis')()",
            "constructor",
            "obj.constructor",
        ]) {
            assert.throws(
                () => SqlTemplateExpression.evaluateTest(expr, stack),
                (err: unknown) => err instanceof SqlTemplateError,
                expr,
            );
        }
    });
});
