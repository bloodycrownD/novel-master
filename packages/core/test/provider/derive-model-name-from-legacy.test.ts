import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveModelNameFromLegacy } from "../../src/domain/provider/logic/derive-model-name-from-legacy.js";
import { formatSavedModelDisplayName } from "../../src/domain/provider/logic/format-saved-model-display-name.js";

describe("deriveModelNameFromLegacy（T-SM13）", () => {
  const providerId = "openai";
  const vendorModelId = "gpt-4o";

  it("NULL / 空 display_name → vendor_model_id", () => {
    assert.equal(
      deriveModelNameFromLegacy(providerId, vendorModelId, null),
      vendorModelId,
    );
    assert.equal(
      deriveModelNameFromLegacy(providerId, vendorModelId, ""),
      vendorModelId,
    );
    assert.equal(
      deriveModelNameFromLegacy(providerId, vendorModelId, "   "),
      vendorModelId,
    );
  });

  it("等于 legacy path → vendor_model_id", () => {
    assert.equal(
      deriveModelNameFromLegacy(
        providerId,
        vendorModelId,
        "openai/gpt-4o",
      ),
      vendorModelId,
    );
  });

  it("以 provider/ 开头 → 去掉前缀后的后缀", () => {
    assert.equal(
      deriveModelNameFromLegacy(providerId, vendorModelId, "openai/写作专用"),
      "写作专用",
    );
  });

  it("其他任意文本 → 原样作为 modelName", () => {
    assert.equal(
      deriveModelNameFromLegacy(providerId, vendorModelId, "写作专用"),
      "写作专用",
    );
  });
});

describe("formatSavedModelDisplayName", () => {
  it("默认 modelName=vendor 时等于 legacy application path", () => {
    assert.equal(
      formatSavedModelDisplayName("openai", "gpt-4o"),
      "openai/gpt-4o",
    );
  });
});
