/**
 * Resolves per-model token counter override from saved model settings.
 *
 * @module service/provider/logic/resolve-token-counter-mode-for-model
 */

import type { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { TokenizerOverride } from "@/infra/tokenizer/logic/resolve-tokenizer-family.js";
import type { ProviderModelService } from "../provider-model.port.js";

/** 读口只需 getTokenCounterMode 这一个能力。 */
type TokenCounterModeReader = Pick<ProviderModelService, "getTokenCounterMode">;
type TokenCounterModeResult = Promise<Result<TokenizerOverride, AppError>>;

/**
 * Returns saved model token counter mode, or `"auto"` when model is unknown;
 * 读口失败沿 `Result.err` 透传（五期门⑦）。
 */
export async function resolveTokenCounterModeForModel(providerModels: TokenCounterModeReader, savedModelId: string | null | undefined): TokenCounterModeResult {
  if (savedModelId == null || savedModelId === "") {
    return Result.ok("auto");
  }
  return providerModels.getTokenCounterMode(savedModelId);
}
