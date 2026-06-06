import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveTokenCounterModeForModel } from "../../src/service/provider/logic/resolve-token-counter-mode-for-model.js";
import type { ProviderModelService } from "../../src/service/provider/provider-model.port.js";

function stubProviderModels(
  modes: Record<string, string>,
): Pick<ProviderModelService, "getTokenCounterMode"> {
  return {
    async getTokenCounterMode(applicationModelId: string) {
      return (modes[applicationModelId] ?? "auto") as "auto";
    },
  };
}

describe("resolveTokenCounterModeForModel", () => {
  it("returns auto for null or empty applicationModelId", async () => {
    const models = stubProviderModels({});
    assert.equal(await resolveTokenCounterModeForModel(models, null), "auto");
    assert.equal(await resolveTokenCounterModeForModel(models, ""), "auto");
    assert.equal(
      await resolveTokenCounterModeForModel(models, undefined),
      "auto",
    );
  });

  it("delegates to getTokenCounterMode for saved model", async () => {
    const models = stubProviderModels({
      "openai/gpt-4o": "heuristic",
    });
    assert.equal(
      await resolveTokenCounterModeForModel(models, "openai/gpt-4o"),
      "heuristic",
    );
  });
});
