/**
 * 思考上下文预过滤口径：双端 prompt-preview 共用的单一实现。
 *
 * 与 wire 侧同源（边界判定在 apply-thinking-context-for-llm 纯函数，
 * 本函数只负责喂给它之前的「偏好 + 档位 + 协议」快照）：
 *
 * - savedModelId 解析优先级与 wire 侧 resolveSavedModelId 一致：
 *   agent pin 模型 → 会话 modelId 覆盖，再 savedModels.findById 读档位
 *   （`thinkingLevel !== "off"`）；取不到模型时按 true 兜底（档位按开态参与判定）。
 * - 协议经 inferLlmProtocolFromSavedModelId 推断；savedModelId 缺失时兜底 anthropic。
 * - 预览不展示协议最低保留（`retainProtocolMinimum` 由调用方置 false，不向用户暴露）。
 *
 * 入参全部为 repo 端口 Pick 窄切片，不依赖双端 runtime 类型。
 *
 * @module service/prompt/resolve-preview-thinking-context
 */

import { resolveSavedModelId } from "@/domain/agent/logic/resolve-saved-model-id.js";
import { inferLlmProtocolFromSavedModelId } from "@/domain/provider/logic/infer-llm-protocol-from-model-id.js";
import type { SavedModelRepository } from "@/domain/provider/repositories/saved-model.port.js";
import type { ProviderRepository } from "@/domain/provider/repositories/provider.port.js";
import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";
import type { PersistentPreferences } from "../persistent-preferences/persistent-preferences.port.js";

/** 预览思考上下文解析入参（端口窄切片 + 已解析的模型 id）。 */
export interface ResolvePreviewThinkingContextInput {
  /** 偏好窄切片：读「思考内容进入上下文」开关。 */
  readonly preferences: Pick<
    PersistentPreferences,
    "getThinkingContextEnabled"
  >;
  /** 已保存模型仓库窄切片：读思考档位、参与协议推断。 */
  readonly savedModels: Pick<SavedModelRepository, "findById">;
  /** 服务商仓库窄切片：参与协议推断。 */
  readonly providers: Pick<ProviderRepository, "findById">;
  /** agent pin 模型（优先于会话覆盖）。 */
  readonly agentModelId?: string;
  /** 会话级模型覆盖（`SessionAgentConfig` 的 `modelId`）。 */
  readonly sessionModelId?: string;
}

/** 预览思考上下文解析结果。 */
export interface ResolvedPreviewThinkingContext {
  readonly enabled: boolean;
  readonly requestThinkingEnabled: boolean;
  readonly protocol: LlmProtocolKind;
}

/** 解析预览用的思考上下文快照（双端 prompt-preview 各调一次）。 */
export async function resolvePreviewThinkingContext(
  input: ResolvePreviewThinkingContextInput
): Promise<ResolvedPreviewThinkingContext> {
  const { preferences, savedModels, providers, agentModelId, sessionModelId } =
    input;
  const enabled = await preferences.getThinkingContextEnabled();
  const savedModelId = resolveSavedModelId({ agentModelId, sessionModelId });
  let requestThinkingEnabled = true;
  if (savedModelId != null && savedModelId !== "") {
    const saved = await savedModels.findById(savedModelId);
    if (saved != null) {
      requestThinkingEnabled =
        saved.settings.generation.thinkingLevel !== "off";
    }
  }
  const protocol =
    savedModelId != null && savedModelId !== ""
      ? await inferLlmProtocolFromSavedModelId(
          savedModelId,
          savedModels,
          providers
        )
      : "anthropic";
  return { enabled, requestThinkingEnabled, protocol };
}
