import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqlTemplateParser } from "../../../src/infra/sql-template/index.js";
import { SqlTemplateError } from "../../../src/infra/sql-template/errors.js";

describe("errors", () => {
  const parser = new SqlTemplateParser();

  it("#13 UNKNOWN_TAG at parse time", () => {
    assert.throws(
      () => parser.parse("<unknown>x</unknown>", {}),
      (err: unknown) => {
        assert.ok(err instanceof SqlTemplateError);
        assert.equal(err.code, "UNKNOWN_TAG");
        return true;
      },
    );
  });

  it("#14 UNCLOSED_TAG", () => {
    assert.throws(
      () => parser.parse('<if test="x">', {}),
      (err: unknown) => {
        assert.ok(err instanceof SqlTemplateError);
        assert.equal(err.code, "UNCLOSED_TAG");
        return true;
      },
    );
  });

  it("#15 EXPRESSION_ERROR for invalid test", () => {
    const template = '<if test=")">x</if>';
    const testOffset = template.indexOf('test="') + 'test="'.length - 1;
    assert.throws(
      () => parser.parse(template, {}),
      (err: unknown) => {
        assert.ok(err instanceof SqlTemplateError);
        assert.equal(err.code, "EXPRESSION_ERROR");
        assert.equal(err.offset, testOffset);
        return true;
      },
    );
  });
});
