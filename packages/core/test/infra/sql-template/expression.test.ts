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
        const enabled = SqlTemplateExpression.evaluateTest("enabled", stack);
        assert.ok(enabled.ok);
        assert.equal(enabled.value, true);
        const missing = SqlTemplateExpression.evaluateTest("missing != null", stack);
        assert.ok(missing.ok);
        assert.equal(missing.value, false);
        const combined = SqlTemplateExpression.evaluateTest("name != null and name != ''", stack);
        assert.ok(combined.ok);
        assert.equal(combined.value, false);
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
        const nameAnd = SqlTemplateExpression.evaluateTest("name == 'and'", stack);
        assert.ok(nameAnd.ok);
        assert.equal(nameAnd.value, true);
        const statusOr = SqlTemplateExpression.evaluateTest('status == "or"', stack);
        assert.ok(statusOr.ok);
        assert.equal(statusOr.value, true);
        const nameOr = SqlTemplateExpression.evaluateTest("name == 'or'", stack);
        assert.ok(nameOr.ok);
        assert.equal(nameOr.value, false);
    });

    it("rejects constructor sandbox escape vectors", () => {
        const stack = [{}];
        for (const expr of [
            "(0).constructor.constructor('return globalThis')()",
            "constructor",
            "obj.constructor",
        ]) {
            const rejected = SqlTemplateExpression.evaluateTest(expr, stack);
            assert.ok(!rejected.ok, expr);
            assert.ok(rejected.error instanceof SqlTemplateError, expr);
        }
    });
});
