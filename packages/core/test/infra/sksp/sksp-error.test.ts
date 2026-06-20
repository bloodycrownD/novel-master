import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SkspError, assertValidRef } from "../../../src/infra/sksp/sksp-error.js";

describe("assertValidRef", () => {
  it("accepts normal refs", () => {
    assert.doesNotThrow(() => assertValidRef("provider/openai/apiKey"));
  });

  it("rejects empty ref", () => {
    assert.throws(
      () => assertValidRef(""),
      (e) => e instanceof SkspError && e.code === "INVALID_REF",
    );
  });

  it("rejects overlong ref", () => {
    assert.throws(
      () => assertValidRef("x".repeat(513)),
      (e) => e instanceof SkspError && e.code === "INVALID_REF",
    );
  });

  it("rejects null byte in ref", () => {
    assert.throws(
      () => assertValidRef("provider/openai\0/apiKey"),
      (e) => e instanceof SkspError && e.code === "INVALID_REF",
    );
  });
});
