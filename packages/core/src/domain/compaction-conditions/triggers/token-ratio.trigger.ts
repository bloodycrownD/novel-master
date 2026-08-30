/**
 * Token-ratio compaction condition (v3; uses persisted context window).
 *
 * @module domain/compaction-conditions/triggers/token-ratio.trigger
 */

import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";
import { resolveCurrentPromptTokens } from "@/infra/tokenizer/logic/resolve-current-prompt-tokens.js";
import type { TokenCounterRegistry } from "@/infra/tokenizer/ports/token-counter-registry.port.js";
import type { TokenizerOverride } from "@/infra/tokenizer/logic/resolve-tokenizer-family.js";
import type {
  CompactionEvaluationContext,
  CompactionConditionTrigger,
} from "../ports/compaction-condition-trigger.port.js";

export interface TokenRatioTriggerOptions {
  readonly tokenRatio: number;
  readonly resolveContextWindow: (
    evaluation: CompactionEvaluationContext
  ) => Promise<number | null>;
  /** Per-model tokenizer override (same source as Chat / CLI token counts). */
  readonly resolveTokenizerOverride: (
    evaluation: CompactionEvaluationContext
  ) => Promise<TokenizerOverride>;
  /**
   * 当计数走 heuristic 时，effective 阈值再乘这个系数（< 1）。
   * heuristic 容易低估真实 token 数，所以把阈值压低、让压缩更早触发，
   * 避免因计数不准而冲破上下文窗口。默认 {@link DEFAULT_HEURISTIC_SAFETY_FACTOR}。
   */
  readonly heuristicSafetyFactor?: number;
}

/**
 * heuristic 计数的默认保守系数：阈值打到精确档的 85%，
 * 留出 15% 的缓冲吸收估算误差。仅当 counterKind === "heuristic" 时生效。
 */
export const DEFAULT_HEURISTIC_SAFETY_FACTOR = 0.85;

/** Fires when full prompt tokens exceed `floor(contextWindow * tokenRatio)`. */
export class TokenRatioConditionTrigger implements CompactionConditionTrigger {
  constructor(
    private readonly options: TokenRatioTriggerOptions,
    private readonly tokenCounters: TokenCounterRegistry
  ) {}

  async shouldTrigger(
    _session: AgentSession,
    evaluation: CompactionEvaluationContext
  ): Promise<boolean> {
    const contextWindow = await this.options.resolveContextWindow(evaluation);
    if (contextWindow == null) {
      return false;
    }

    const tokenizerOverride = await this.options.resolveTokenizerOverride(
      evaluation
    );
    const { tokenCount, counterKind } = await resolveCurrentPromptTokens(
      evaluation.sessionId,
      {
        layout: evaluation.layout,
        ctx: evaluation.ctx,
        savedModelId: evaluation.modelContext.savedModelId,
        registry: this.tokenCounters,
        tokenizerOverride,
      }
    );

    // heuristic 计数不精确（可能低估），触发保守阈值：
    // 把比例阈值再乘一个 < 1 的安全系数，让压缩比精确计数更早发生。
    const safetyFactor =
      counterKind === "heuristic"
        ? this.options.heuristicSafetyFactor ?? DEFAULT_HEURISTIC_SAFETY_FACTOR
        : 1;
    const effective = Math.floor(
      contextWindow * this.options.tokenRatio * safetyFactor
    );
    return tokenCount > effective;
  }
}
