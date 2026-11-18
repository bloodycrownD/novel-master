import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatSavedModelDisplayName } from "../../src/domain/provider/logic/format-saved-model-display-name.js";

describe("formatSavedModelDisplayName", () => {
  it("默认 modelName=vendor 时等于 legacy application path", () => {
    assert.equal(
      formatSavedModelDisplayName("openai", "gpt-4o"),
      "openai/gpt-4o",
    );
  });
});
