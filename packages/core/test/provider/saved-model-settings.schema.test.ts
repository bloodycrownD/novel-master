import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ProviderError } from "../../src/errors/provider-errors.js";
import { savedModelSettingsFromJson } from "../../src/domain/provider/model/saved-model-settings-from-json.js";
import { savedModelSettingsToJson } from "../../src/domain/provider/model/saved-model-settings-from-json.js";
import { defaultSavedModelSettings } from "../../src/domain/provider/model/default-saved-model-settings.js";

describe("savedModelSettings schema", () => {
  it("missing tokenCounterMode defaults to auto", () => {
    const settings = savedModelSettingsFromJson({
      schemaVersion: 1,
      contextWindowTokens: 128_000,
      sampling: { enabled: false },
    });
    assert.equal(settings.tokenCounterMode, "auto");
  });

  it("rejects invalid tokenCounterMode", () => {
    assert.throws(
      () =>
        savedModelSettingsFromJson({
          schemaVersion: 1,
          contextWindowTokens: 128_000,
          sampling: { enabled: false },
          tokenCounterMode: "not-a-mode",
        }),
      (e) => e instanceof ProviderError && e.code === "INVALID_ARGUMENT",
    );
  });

  it("round-trips tokenCounterMode in JSON", () => {
    const defaults = defaultSavedModelSettings("gpt-4o");
    const settings = {
      ...defaults,
      tokenCounterMode: "gemma" as const,
    };
    const json = savedModelSettingsToJson(settings);
    assert.equal(json.tokenCounterMode, "gemma");
    const parsed = savedModelSettingsFromJson(json);
    assert.equal(parsed.tokenCounterMode, "gemma");
  });
});
