/**
 * Resolves per-model token counter override from saved model settings.
 *
 * @module service/provider/logic/resolve-token-counter-mode-for-model
 */

import type { TokenizerOverride } from "@/infra/tokenizer/logic/resolve-tokenizer-family.js";
import type { ProviderModelService } from "../provider-model.port.js";

/** Returns saved model token counter mode, or `"auto"` when model is unknown. */
export async function resolveTokenCounterModeForModel(
  providerModels: Pick<ProviderModelService, "getTokenCounterMode">,
  applicationModelId: string | null | undefined,
): Promise<TokenizerOverride> {
  if (applicationModelId == null || applicationModelId === "") {
    return "auto";
  }
  return providerModels.getTokenCounterMode(applicationModelId);
}
