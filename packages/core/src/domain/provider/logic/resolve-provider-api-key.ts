/**
 * 解析有效的 provider API key（SKSP 覆盖，再回落到内置默认）。
 *
 * @module domain/provider/logic/resolve-provider-api-key
 */

import { ProviderError, providerApiKeyNotSetMessage } from "@/errors/provider-errors.js";
import {
  resolveProviderApiKeySecretRef,
  type LlmProvider,
} from "@/domain/provider/model/provider.js";
import type { SecretStore } from "@/infra/sksp/ports/secret-store.port.js";
import { builtinDefaultApiKey } from "./builtin-providers.js";

/**
 * 返回 SKSP 存储的密钥，否则按 builtin_key 取内置默认。
 */
export async function resolveProviderApiKey(
  provider: Pick<LlmProvider, "id" | "secretRef" | "builtinKey">,
  secretStore: SecretStore,
): Promise<string> {
  const ref = resolveProviderApiKeySecretRef(provider);
  const stored = await secretStore.get(ref);
  if (stored != null && stored !== "") {
    return stored;
  }
  const fallback =
    provider.builtinKey != null
      ? builtinDefaultApiKey(provider.builtinKey)
      : undefined;
  if (fallback != null && fallback !== "") {
    return fallback;
  }
  throw new ProviderError("API_KEY_NOT_SET", providerApiKeyNotSetMessage(provider.id), {
    providerId: provider.id,
  });
}

/** list/UI 是否应把该服务商视为已配置可用 API key。 */
export async function providerApiKeyIsConfigured(
  provider: Pick<LlmProvider, "id" | "secretRef" | "builtinKey">,
  secretStore: SecretStore,
): Promise<boolean> {
  const ref = resolveProviderApiKeySecretRef(provider);
  if (await secretStore.has(ref)) {
    return true;
  }
  return (
    provider.builtinKey != null && builtinDefaultApiKey(provider.builtinKey) != null
  );
}
