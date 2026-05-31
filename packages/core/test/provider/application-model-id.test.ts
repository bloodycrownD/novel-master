import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatApplicationModelId,
  parseApplicationModelId,
  normalizeVendorModelId,
} from "../../src/domain/provider/logic/application-model-id.js";
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

  it("normalizes vendor ids from application ids and API paths", () => {
    assert.equal(normalizeVendorModelId("zhipu", "zhipu/glm-4-flash"), "glm-4-flash");
    assert.equal(
      normalizeVendorModelId("zhipu", "models/glm-4-flash"),
      "glm-4-flash",
    );
    assert.equal(normalizeVendorModelId("openai", "gpt-4o/mini"), "gpt-4o/mini");
    assert.equal(
      formatApplicationModelId("zhipu", "zhipu/glm-4-flash"),
      "zhipu/glm-4-flash",
    );
  });
});
