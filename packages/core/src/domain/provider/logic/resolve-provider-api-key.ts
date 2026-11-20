/**
 * 解析有效的 provider API key（SKSP 覆盖，再回落到内置默认）。
 *
 * @module domain/provider/logic/resolve-provider-api-key
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { ProviderModel, type LlmProvider } from "@/domain/provider/model/provider.js";
import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";
import { BuiltinProviders } from "./builtin-providers.js";

type ProviderApiKeyError = AppError<"PROVIDER_API_KEY_NOT_SET">;

export const ProviderApiKey = {
  /**
   * 返回 SKSP 存储的密钥，否则按 builtin_key 取内置默认。
   */
  async resolve(provider: Pick<LlmProvider, "id" | "secretRef" | "builtinKey">, secretStore: SecretStore): Promise<Result<string, ProviderApiKeyError>> {
    const ref = ProviderModel.resolveApiKeySecretRef(provider);
    const stored = await secretStore.get(ref);
    if (stored != null && stored !== "") {
      return Result.ok(stored);
    }
    const fallback = provider.builtinKey != null ? BuiltinProviders.defaultApiKey(provider.builtinKey) : undefined;
    if (fallback != null && fallback !== "") {
      return Result.ok(fallback);
    }
    return Result.err(new AppError("PROVIDER_API_KEY_NOT_SET", { detail: `API key not set for provider ${provider.id}. Configure it in provider settings.`, providerId: provider.id }));
  },

  /** list/UI 是否应把该服务商视为已配置可用 API key。 */
  async isConfigured(provider: Pick<LlmProvider, "id" | "secretRef" | "builtinKey">, secretStore: SecretStore): Promise<boolean> {
    const ref = ProviderModel.resolveApiKeySecretRef(provider);
    if (await secretStore.has(ref)) {
      return true;
    }
    return provider.builtinKey != null && BuiltinProviders.defaultApiKey(provider.builtinKey) != null;
  },
} as const;
