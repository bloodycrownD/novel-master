/**
 * Unified prompt token count — delegates to NMTP driver registry.
 *
 * @module infra/tokenizer/logic/count-prompt-llm-input
 */

import type { SavedModelRepository } from "@/domain/provider/repositories/saved-model.port.js";
import type { AgentPromptLayout } from "@/domain/prompt/model/agent-prompt-layout.js";
import type { PromptRenderContext } from "@/domain/prompt/model/prompt-render-context.js";
import type { LlmToolDefinition } from "@/infra/llm-protocol/ports/adapter.port.js";
import { resolveTokenizerDriver } from "../../nmtp/logic/registry.js";
import type {
  TokenCounterKind,
  TokenizerFamily,
} from "../ports/token-counter.port.js";
import type { TokenCounterRegistry } from "../ports/token-counter-registry.port.js";
import type { TokenizerOverride } from "./resolve-tokenizer-family.js";
import { resolveTokenizerFamily } from "./resolve-tokenizer-family.js";
import { serializePromptLlmInput } from "./serialize-prompt-input.js";
import { serializeToolsForTokenCount } from "./serialize-tools-for-token-count.js";

export interface CountPromptLlmInputParams {
  readonly layout: AgentPromptLayout;
  readonly ctx: PromptRenderContext;
  readonly savedModelId: string;
  readonly registry: TokenCounterRegistry;
  readonly tokenizerOverride?: TokenizerOverride;
  /** When set, resolves vendor model id via {@link findById}. */
  readonly savedModels?: Pick<SavedModelRepository, "findById">;
  /**
   * 本次请求随提示词一起发出的 tools 定义（可选）。
   *
   * 本地计数把它折算进序列化串（{@link serializeToolsForTokenCount}），与 API
   * 的 `promptTokens`（含 tools）口径可比。**压缩评估路径必须传**
   * （agent-runner 有现成 tools）；UI 读口路径拿不到 tools，缺省即不数。
   */
  readonly tools?: readonly LlmToolDefinition[];
  /**
   * 会话标识（可选，仅驱动取消链路消费）。
   *
   * 读口 `resolveCurrentPromptTokens` 从自己的 `sessionId` 实参透传进来；
   * RN 驱动据此生成 `${sessionId}:${seq}` 形式的 requestId 并登记 in-flight，
   * 用户侧滑切走会话时才能精确取消在途的原生整串计数。
   *
   * **不进缓存语义**：L1/L2 的会话语义由读口层单独处理（驱动内部查缓存一律
   * 传空 sessionId），本字段只为取消归属存在。缺省即「不可取消轮」——
   * node 驱动忽略它，其余读口不传时行为与既有逐字节一致。
   */
  readonly sessionId?: string;
}

export interface PromptTokenCountResult {
  readonly tokenCount: number;
  readonly counterKind: TokenCounterKind;
  readonly estimated: boolean;
  readonly savedModelId: string;
  readonly vendorModelId: string;
  readonly tokenizerFamily: TokenizerFamily;
}

/**
 * Counts tokens for a full prompt via registered NMTP driver (assembly serialize).
 */
export async function countPromptLlmInput(
  params: CountPromptLlmInputParams
): Promise<PromptTokenCountResult> {
  return resolveTokenizerDriver().countPromptLlmInput(params);
}

export async function resolveVendorModelIdFromSaved(
  savedModelId: string,
  savedModels?: Pick<SavedModelRepository, "findById">
): Promise<string> {
  if (savedModels == null) {
    return savedModelId;
  }
  const saved = await savedModels.findById(savedModelId.trim());
  return saved?.vendorModelId ?? savedModelId;
}

/** Minimal fallback without a registered driver (tests / documentation). */
export async function countPromptLlmInputHeuristicOnly(
  params: CountPromptLlmInputParams
): Promise<PromptTokenCountResult> {
  const { savedModelId, registry, layout, ctx } = params;
  const vendorModelId = await resolveVendorModelIdFromSaved(
    savedModelId,
    params.savedModels
  );
  const family = resolveTokenizerFamily(vendorModelId, "auto");
  // tools 段与提示词同串计数（空 tools 时拼接为恒等；口径见 helper 头注释）。
  const serialized =
    (await serializePromptLlmInput(layout, ctx)) +
    serializeToolsForTokenCount(params.tools);
  const tokenCount = registry.heuristic.countText(serialized);
  return {
    tokenCount,
    counterKind: "heuristic",
    estimated: true,
    savedModelId,
    vendorModelId,
    tokenizerFamily: family,
  };
}

// usage label 拼装已随 token-source-label 收敛进 common/format-token-count.ts
// （formatContextUsageLabel，badge 单源）；本文件此前的第二份
// formatPromptTokenUsageLabel/formatCompact 系零生产调用方的重复实现，已删除。
