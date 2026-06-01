/**
 * Factory for {@link DefaultAgentRunner}.
 *
 * @module service/agent/create-agent-runner
 */

import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";
import type { ToolRegistry } from "@/domain/tool/logic/tool-registry.js";
import type { VfsToolContext } from "@/domain/tool/builtin/vfs-tools.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { ModelRequestService } from "../provider/model-request.port.js";
import type { RegexConfigService } from "../regex/regex-config.port.js";
import type { SimpleEventBus } from "@/infra/events/simple-event-bus.js";
import type { SessionMacroCache } from "../prompt/session-macro-cache.port.js";
import type { CompactionConditionEvaluator } from "../compaction-conditions/create-compaction-condition-evaluator.js";
import type { EventOrchestrator } from "../events/event-orchestrator.port.js";
import type { AgentRunner } from "./agent.port.js";
import { DefaultAgentRunner } from "./impl/agent-runner.js";

export interface CreateAgentRunnerDeps {
  readonly session: AgentSession;
  readonly modelRequests: ModelRequestService;
  readonly registry: ToolRegistry<VfsToolContext>;
  readonly toolCtx: VfsToolContext;
  readonly eventBus: SimpleEventBus;
  readonly macroCache: SessionMacroCache;
  readonly compactionConditions?: CompactionConditionEvaluator;
  readonly eventOrchestrator?: EventOrchestrator;
  readonly regexConfig?: RegexConfigService;
  readonly listAllSessionMessages?: () => Promise<readonly ChatMessage[]>;
}

/** Creates an agent runner with injected dependencies. */
export function createAgentRunner(deps: CreateAgentRunnerDeps): AgentRunner {
  return new DefaultAgentRunner(deps);
}
