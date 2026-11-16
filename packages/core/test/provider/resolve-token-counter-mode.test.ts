import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveTokenCounterModeForModel } from "../../src/service/provider/logic/resolve-token-counter-mode-for-model.js";
import type { ProviderModelService } from "../../src/service/provider/provider-model.port.js";
import { unwrap } from "../helpers/result-unwrap.js";

function stubProviderModels(
  modes: Record<string, string>,
): Pick<ProviderModelService, "getTokenCounterMode"> {
  return {
    // 错误通道迁移四期：getTokenCounterMode 走 Result 通道。
    async getTokenCounterMode(savedModelId: string) {
      const r: Awaited<ReturnType<ProviderModelService["getTokenCounterMode"]>> =
        (modes[savedModelId] ?? "auto") as never;
      return r;
    },
  };
}

describe("resolveTokenCounterModeForModel", () => {
  it("returns auto for null or empty savedModelId", async () => {
    const models = stubProviderModels({});
    assert.equal(unwrap(await resolveTokenCounterModeForModel(models, null)), "auto");
    assert.equal(unwrap(await resolveTokenCounterModeForModel(models, "")), "auto");
    assert.equal(
      unwrap(await resolveTokenCounterModeForModel(models, undefined)),
      "auto",
    );
  });

  it("delegates to getTokenCounterMode for saved model", async () => {
    const models = stubProviderModels({
      "00000000-0000-4000-8000-000000000010": "heuristic",
    });
    assert.equal(
      unwrap(await resolveTokenCounterModeForModel(
        models,
        "00000000-0000-4000-8000-000000000010",
      )),
      "heuristic",
    );
  });
});
