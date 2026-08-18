/**
 * Factory for {@link DefaultAgentRunner}.
 *
 * @module service/agent/create-agent-runner
 */

import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";
import type { ToolRegistry } from "@/domain/tool/logic/tool-registry.js";
import type { BuiltinToolContext } from "@/domain/tool/builtin/builtin-tool-context.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { ProviderRepository } from "@/domain/provider/repositories/provider.port.js";
import type { SavedModelRepository } from "@/domain/provider/repositories/saved-model.port.js";
import type { ModelRequestService } from "../provider/model-request.port.js";
import type { RegexConfigService } from "../regex/regex-config.port.js";
import type { SimpleEventBus } from "@/infra/events/simple-event-bus.js";
import type { SessionKkvService } from "../session-kkv/session-kkv.port.js";
import type { WorkplaceService } from "../workplace/workplace.port.js";
import type { CompactionConditionEvaluator } from "../compaction-conditions/create-compaction-condition-evaluator.js";
import type { MessageService } from "../chat/message.port.js";
import type { MessageTranscriptEffectsService } from "../chat/message-transcript-effects.port.js";
import type { MessageCheckpointService } from "../message-checkpoint/message-checkpoint.port.js";
import type { AgentRunner } from "./agent.port.js";
import type { AgentStreamRegistry } from "./agent-stream-registry.port.js";
import type { SkillService } from "@/service/skills/skills.port.js";
import { DefaultAgentRunner } from "./impl/agent-runner.js";

export interface CreateAgentRunnerDeps {
  readonly session: AgentSession;
  readonly modelRequests: ModelRequestService;
  readonly savedModels: SavedModelRepository;
  readonly providers?: Pick<ProviderRepository, "findById">;
  readonly registry: ToolRegistry<BuiltinToolContext>;
  readonly toolCtx: BuiltinToolContext;
  /**
   * skillAttach hydrate（`$技能` 首次引用附全文）的技能服务工厂；不随 D4
   * （skill deny）置空——显式引用不受工具禁用影响。
   */
  readonly skills?: () => SkillService;
  readonly eventBus: SimpleEventBus;
  /** 常驻工作区前缀经 {@link assembleWorkplaceDisplay} 读写。 */
  readonly sessionKkv: SessionKkvService;
  readonly workplace: (scope: VfsScope) => WorkplaceService;
  /**
   * mutating 工具并行 settled 后同步 checkpoint；失败会中断当前 agent run。
   * @remarks 在 append tool_results 之前 await，避免对话继续但无 checkpoint。
   */
  readonly messageCheckpoint?: MessageCheckpointService;
  readonly compactionConditions?: CompactionConditionEvaluator;
  /**
   * 压缩执行所需的消息服务；对话轨由 assembleAgentRunnerDeps 注入。
   * 条件压缩命中时与 messageTranscriptEffects 同进同退。
   */
  readonly messages?: MessageService;
  /** 压缩执行所需的 transcript effects；对话轨由 assembleAgentRunnerDeps 注入。 */
  readonly messageTranscriptEffects?: MessageTranscriptEffectsService;
  readonly regexConfig?: RegexConfigService;
  readonly listAllSessionMessages?: () => Promise<readonly ChatMessage[]>;
  /** 按 sessionId 累积 in-flight 流式 partial，供子会话首次进入查询。 */
  readonly streamRegistry?: AgentStreamRegistry;
}

/** Creates an agent runner with injected dependencies. */
export function createAgentRunner(deps: CreateAgentRunnerDeps): AgentRunner {
  return new DefaultAgentRunner(deps);
}
