/**
 * Resolves per-model token counter override from saved model settings.
 *
 * @module service/provider/logic/resolve-token-counter-mode-for-model
 */

import type { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { TokenizerOverride } from "@/infra/tokenizer/logic/resolve-tokenizer-family.js";
import type { ProviderModelService } from "../provider-model.port.js";

/**
 * Returns saved model token counter mode, or `"auto"` when model is unknown;
 * 读口失败沿 `Result.err` 透传（五期门⑦）。
 */
export async function resolveTokenCounterModeForModel(
  providerModels: Pick<ProviderModelService, "getTokenCounterMode">,
  savedModelId: string | null | undefined
): Promise<Result<TokenizerOverride, AppError>> {
  if (savedModelId == null || savedModelId === "") {
    return Result.ok("auto");
  }
  return providerModels.getTokenCounterMode(savedModelId);
}
