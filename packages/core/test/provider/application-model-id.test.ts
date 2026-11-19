import {  describe, it  } from "node:test";
import assert from "node:assert/strict";
import {  ApplicationModelId  } from "../../src/domain/provider/logic/application-model-id.js";

describe("application model id", () => {
  it("splits on first slash only", () => {
    const parsed = ApplicationModelId.parse("openai/gpt-4o/mini");
    if (!parsed.ok) {
      assert.fail(parsed.error.message);
    }
    assert.equal(parsed.value.providerId, "openai");
    assert.equal(parsed.value.vendorModelId, "gpt-4o/mini");
    assert.equal(ApplicationModelId.format("openai", "gpt-4o/mini"), "openai/gpt-4o/mini");
  });

  it("rejects invalid ids", () => {
    const parsed = ApplicationModelId.parse("nope");
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.equal(parsed.error.key, "PROVIDER_INVALID_ARGUMENT");
      assert.deepEqual(parsed.error.details, { modelId: "nope", detail: "Invalid application model id: nope" });
    }
  });

  it("normalizes vendor ids from application ids and API paths", () => {
    assert.equal(ApplicationModelId.normalizeVendorModelId("zhipu", "zhipu/glm-4-flash"), "glm-4-flash");
    assert.equal(ApplicationModelId.normalizeVendorModelId("zhipu", "models/glm-4-flash"), "glm-4-flash");
    assert.equal(ApplicationModelId.normalizeVendorModelId("openai", "gpt-4o/mini"), "gpt-4o/mini");
    assert.equal(ApplicationModelId.format("zhipu", "zhipu/glm-4-flash"), "zhipu/glm-4-flash");
  });
});
