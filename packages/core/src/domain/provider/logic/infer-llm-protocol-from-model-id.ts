/**
 * 从已保存模型 UUID 推断 LLM 协议（导出路径等）。
 *
 * @module domain/provider/logic/infer-llm-protocol-from-model-id
 */

import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";
import { BUILTIN_PROVIDER_PROTOCOLS, BUILTIN_PROVIDER_UUID_PROTOCOLS } from "./builtin-providers.js";
import type { ProviderRepository } from "../repositories/provider.port.js";
import type { SavedModelRepository } from "../repositories/saved-model.port.js";

export const LlmProtocol = {
    /**
   * 查 saved model → provider：内置经固定 UUID→protocol（或 builtin_key）；
   * 自定义走行上 protocol 字段（须传入 providers）。
   */
    async fromSavedModelId(savedModelId: string, savedModels: Pick<SavedModelRepository, "findById">, providers?: Pick<ProviderRepository, "findById">): Promise<LlmProtocolKind> {
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
    },
} as const;
