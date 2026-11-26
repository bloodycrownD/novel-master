import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  SqlTemplateParser  } from "@/infra/sql-template/index.js";
import {  SqlTemplateError  } from "@/infra/sql-template/errors.js";

describe("errors", () => {
    const parser = new SqlTemplateParser();

    it("#13 UNKNOWN_TAG at parse time", () => {
        const parsed = parser.parse("<unknown>x</unknown>", {});
        assert.ok(!parsed.ok);
        assert.ok(parsed.error instanceof SqlTemplateError);
        assert.equal(parsed.error.code, "UNKNOWN_TAG");
    });

    it("#14 UNCLOSED_TAG", () => {
        const parsed = parser.parse('<if test="x">', {});
        assert.ok(!parsed.ok);
        assert.ok(parsed.error instanceof SqlTemplateError);
        assert.equal(parsed.error.code, "UNCLOSED_TAG");
    });

    it("#15 EXPRESSION_ERROR for invalid test", () => {
        const template = '<if test=")">x</if>';
        const testOffset = template.indexOf('test="') + 'test="'.length - 1;
        const parsed = parser.parse(template, {});
        assert.ok(!parsed.ok);
        assert.ok(parsed.error instanceof SqlTemplateError);
        assert.equal(parsed.error.code, "EXPRESSION_ERROR");
        assert.equal(parsed.error.offset, testOffset);
    });
});
