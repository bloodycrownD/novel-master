/**
 * 从已保存模型 UUID 推断 LLM 协议（导出路径等）。
 *
 * @module domain/provider/logic/infer-llm-protocol-from-model-id
 */

import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";
import { BUILTIN_PROVIDER_PROTOCOLS, BUILTIN_PROVIDER_UUID_PROTOCOLS } from "./builtin-providers.js";
import type { ProviderRepository } from "../repositories/provider.port.js";
import type { SavedModelRepository } from "../repositories/saved-model.port.js";

/**
 * 查 saved model → provider：内置经固定 UUID→protocol（或 builtin_key）；
 * 自定义走行上 protocol 字段（须传入 providers）。
 */
export async function inferLlmProtocolFromSavedModelId(savedModelId: string, savedModels: Pick<SavedModelRepository, "findById">, providers?: Pick<ProviderRepository, "findById">): Promise<LlmProtocolKind> {
  try {
    const saved = await savedModels.findById(savedModelId.trim());
    if (!saved.ok || saved.value == null) {
      return "anthropic";
    }

    const byUuid = BUILTIN_PROVIDER_UUID_PROTOCOLS[saved.value.providerId];
    if (byUuid != null) {
      return byUuid;
    }

    if (providers == null) {
      return "anthropic";
    }

    const provider = await providers.findById(saved.value.providerId);
    if (!provider.ok || provider.value == null) {
      return "anthropic";
    }
    const row = provider.value;
    if (row.builtinKey != null) {
      return BUILTIN_PROVIDER_PROTOCOLS[row.builtinKey] ?? row.protocol;
    }
    return row.protocol;
  } catch {
    return "anthropic";
  }
}

/**
 * @deprecated 请用 {@link inferLlmProtocolFromSavedModelId}。
 *
 * nm-style: keep-public — `public/provider.ts` 仍导出该兼容别名，撤除需同步 public
 * barrel（本轮只改 domain 范围）；生产/测试零调用，收口轮随 barrel 一并删除。
 */
export async function inferLlmProtocolFromApplicationModelId(savedModelId: string, savedModels: Pick<SavedModelRepository, "findById">, providers?: Pick<ProviderRepository, "findById">): Promise<LlmProtocolKind> {
  return inferLlmProtocolFromSavedModelId(savedModelId, savedModels, providers);
}
