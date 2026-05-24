import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatApplicationModelId,
  parseApplicationModelId,
} from "../../src/domain/provider/application-model-id.js";
import { ProviderError } from "../../src/errors/provider-errors.js";

describe("application model id", () => {
  it("splits on first slash only", () => {
    const parsed = parseApplicationModelId("openai/gpt-4o/mini");
    assert.equal(parsed.providerId, "openai");
    assert.equal(parsed.vendorModelId, "gpt-4o/mini");
    assert.equal(
      formatApplicationModelId("openai", "gpt-4o/mini"),
      "openai/gpt-4o/mini",
    );
  });

  it("rejects invalid ids", () => {
    assert.throws(
      () => parseApplicationModelId("nope"),
      (e) => e instanceof ProviderError,
    );
  });
});
