import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveTokenCounterModeForModel } from "../../src/service/provider/logic/resolve-token-counter-mode-for-model.js";
import type { ProviderModelService } from "../../src/service/provider/provider-model.port.js";

function stubProviderModels(
  modes: Record<string, string>,
): Pick<ProviderModelService, "getTokenCounterMode"> {
  return {
    async getTokenCounterMode(savedModelId: string) {
      return (modes[savedModelId] ?? "auto") as "auto";
    },
  };
}

describe("resolveTokenCounterModeForModel", () => {
  it("returns auto for null or empty savedModelId", async () => {
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
      "00000000-0000-4000-8000-000000000010": "heuristic",
    });
    assert.equal(
      await resolveTokenCounterModeForModel(
        models,
        "00000000-0000-4000-8000-000000000010",
      ),
      "heuristic",
    );
  });
});
