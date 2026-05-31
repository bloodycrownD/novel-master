/**
 * Builds sync registry deps from provider and saved-model repositories.
 *
 * @module infra/tokenizer/logic/build-registry-deps
 */

import type { ProviderRepository } from "@/domain/provider/repositories/provider.port.js";
import type { SavedModelRepository } from "@/domain/provider/repositories/saved-model.port.js";
import type { CreateDefaultTokenCounterRegistryDeps } from "./create-default-registry.js";

/**
 * Loads provider protocols (and optional saved-model keys) for sync registry resolution.
 */
export async function buildTokenCounterRegistryDeps(
  providers: ProviderRepository,
  savedModels?: SavedModelRepository,
): Promise<CreateDefaultTokenCounterRegistryDeps> {
  const protocolByProviderId = new Map<string, import("@/infra/llm-protocol/ports/adapter.port.js").LlmProtocolKind>();
  for (const p of await providers.list()) {
    protocolByProviderId.set(p.id, p.protocol);
  }

  let savedKeys: Set<string> | undefined;
  if (savedModels != null) {
    savedKeys = new Set<string>();
    for (const p of await providers.list()) {
      for (const m of await savedModels.listByProvider(p.id)) {
        savedKeys.add(`${p.id}/${m.vendorModelId}`);
      }
    }
  }

  return {
    resolveProviderProtocol: (providerId) => protocolByProviderId.get(providerId),
    isSavedModel: savedKeys
      ? (providerId, vendorModelId) =>
          savedKeys!.has(`${providerId}/${vendorModelId}`)
      : undefined,
  };
}
