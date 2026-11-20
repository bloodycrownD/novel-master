import {  describe, it  } from "node:test";
import assert from "node:assert/strict";
import {  SkspError, SkspRefAssert  } from "../../../src/infra/sksp/sksp-error.js";

describe("assertValidRef", () => {
  it("accepts normal refs", () => {
    assert.doesNotThrow(() => SkspRefAssert.validRef("provider/openai/apiKey"));
  });

  it("rejects empty ref", () => {
    assert.throws(
      () => SkspRefAssert.validRef(""),
      (e) => e instanceof SkspError && e.code === "INVALID_REF",
    );
  });

  it("rejects overlong ref", () => {
    assert.throws(
      () => SkspRefAssert.validRef("x".repeat(513)),
      (e) => e instanceof SkspError && e.code === "INVALID_REF",
    );
  });

  it("rejects null byte in ref", () => {
    assert.throws(
      () => SkspRefAssert.validRef("provider/openai\0/apiKey"),
      (e) => e instanceof SkspError && e.code === "INVALID_REF",
    );
  });
});
