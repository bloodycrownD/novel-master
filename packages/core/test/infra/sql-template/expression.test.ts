import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateTest,
  normalizeExpression,
} from "../../../src/infra/sql-template/expression.js";

describe("expression", () => {
  it("normalizes MyBatis and/or/not", () => {
    assert.equal(
      normalizeExpression("a and b or not c"),
      "a && b || ! c",
    );
  });

  it("evaluates and / != null with undefined properties", () => {
    const stack = [{ enabled: true, name: "" }];
    assert.equal(evaluateTest("enabled", stack), true);
    assert.equal(evaluateTest("missing != null", stack), false);
    assert.equal(
      evaluateTest("name != null and name != ''", stack),
      false,
    );
  });
});
