/**
 * Resolves effective provider API key (SKSP override, then builtin default).
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
 * Returns SKSP-stored key, else builtin default for known built-in providers.
 */
export async function resolveProviderApiKey(
  provider: Pick<LlmProvider, "id" | "secretRef">,
  secretStore: SecretStore,
): Promise<string> {
  const ref = resolveProviderApiKeySecretRef(provider);
  const stored = await secretStore.get(ref);
  if (stored != null && stored !== "") {
    return stored;
  }
  const fallback = builtinDefaultApiKey(provider.id);
  if (fallback != null && fallback !== "") {
    return fallback;
  }
  throw new ProviderError("API_KEY_NOT_SET", providerApiKeyNotSetMessage(provider.id), {
    providerId: provider.id,
  });
}

/** Whether list/UI should treat the provider as having a usable API key. */
export async function providerApiKeyIsConfigured(
  provider: Pick<LlmProvider, "id" | "secretRef">,
  secretStore: SecretStore,
): Promise<boolean> {
  const ref = resolveProviderApiKeySecretRef(provider);
  if (await secretStore.has(ref)) {
    return true;
  }
  return builtinDefaultApiKey(provider.id) != null;
}
