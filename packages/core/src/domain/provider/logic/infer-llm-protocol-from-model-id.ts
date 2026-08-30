/**
 * 从已保存模型 UUID 推断 LLM 协议（导出路径等）。
 *
 * @module domain/provider/logic/infer-llm-protocol-from-model-id
 */

import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";
import {
  BUILTIN_PROVIDER_PROTOCOLS,
  BUILTIN_PROVIDER_UUID_PROTOCOLS,
} from "./builtin-providers.js";
import type { ProviderRepository } from "../repositories/provider.port.js";
import type { SavedModelRepository } from "../repositories/saved-model.port.js";

/**
 * 查 saved model → provider：内置经固定 UUID→protocol（或 builtin_key）；
 * 自定义走行上 protocol 字段（须传入 providers）。
 */
export async function inferLlmProtocolFromSavedModelId(
  savedModelId: string,
  savedModels: Pick<SavedModelRepository, "findById">,
  providers?: Pick<ProviderRepository, "findById">
): Promise<LlmProtocolKind> {
  try {
    const saved = await savedModels.findById(savedModelId.trim());
    if (saved == null) {
      return "anthropic";
    }

    const byUuid = BUILTIN_PROVIDER_UUID_PROTOCOLS[saved.providerId];
    if (byUuid != null) {
      return byUuid;
    }

    if (providers == null) {
      return "anthropic";
    }

    const provider = await providers.findById(saved.providerId);
    if (provider == null) {
      return "anthropic";
    }
    if (provider.builtinKey != null) {
      return (
        BUILTIN_PROVIDER_PROTOCOLS[provider.builtinKey] ?? provider.protocol
      );
    }
    return provider.protocol;
  } catch {
    return "anthropic";
  }
}

/** @deprecated 请用 {@link inferLlmProtocolFromSavedModelId}。 */
export async function inferLlmProtocolFromApplicationModelId(
  savedModelId: string,
  savedModels: Pick<SavedModelRepository, "findById">,
  providers?: Pick<ProviderRepository, "findById">
): Promise<LlmProtocolKind> {
  return inferLlmProtocolFromSavedModelId(savedModelId, savedModels, providers);
}
