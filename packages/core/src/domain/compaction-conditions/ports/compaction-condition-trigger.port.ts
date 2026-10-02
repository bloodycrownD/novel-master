/**
 * Compaction condition trigger port (OR semantics via composite).
 *
 * @module domain/compaction-conditions/ports/compaction-condition-trigger.port
 */

import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";
import type { AgentPromptLayout } from "@/domain/prompt/model/agent-prompt-layout.js";
import type {
  PromptLlmInput,
  PromptRenderContext,
} from "@/domain/prompt/model/prompt-render-context.js";
import type { LlmToolDefinition } from "@/infra/llm-protocol/ports/adapter.port.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";

export interface CompactionConditionModelContext {
  readonly workspaceModelId: string;
  readonly savedModelId: string;
}

export interface CompactionEvaluationContext {
  /** 与展示共用的会话分桶键；runner 填入，禁止从 AgentSession 推断。 */
  readonly sessionId: string;
  readonly modelContext: CompactionConditionModelContext;
  readonly promptInput: PromptLlmInput;
  readonly layout: AgentPromptLayout;
  readonly ctx: PromptRenderContext;
  /**
   * 本次请求随提示词发出的 tools 定义（runner 填入）。
   *
   * 本地 token 计数把 tools 段折算进同一序列化串（见
   * `serializeToolsForTokenCount`），与 API 的 `promptTokens`（含 tools）
   * 口径可比；缺省则不数 tools（非 runner 调用方的降级路径）。
   */
  readonly tools?: readonly LlmToolDefinition[];
  /**
   * 会话 KKV（runner 填入）：token 读口用它取跨重启的 API 占用值。
   * 缺省时读口退化为纯进程内读（测试/非 runner 调用方）。
   */
  readonly sessionKkv?: SessionKkvService;
  /**
   * runner 本 step 已从 `AgentSession.list()` 拿到的可见消息条数。
   *
   * 有了它 {@link VisibleFloorTrigger} 直接复用，不再发第二次全会话读（RT-02）；
   * 缺省（非 runner 调用方 / 既有测试）回落到触发器自己 `session.list()`，
   * 因此这条对所有既有调用方与测试**零行为变化**。
   */
  readonly visibleMessageCount?: number;
}

/** Returns true when this trigger slice is satisfied. */
export interface CompactionConditionTrigger {
  shouldTrigger(
    session: AgentSession,
    evaluation: CompactionEvaluationContext
  ): Promise<boolean>;
}
