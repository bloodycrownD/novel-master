/**
 * Factory for {@link DefaultAgentRunner}.
 *
 * @module service/agent/create-agent-runner
 */

import type { AgentSession } from "@/domain/agent/agent-session.port.js";
import type { ToolRegistry } from "@/domain/tool/tool-registry.js";
import type { VfsToolContext } from "@/domain/tool/builtin/vfs-tools.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { ModelRequestService } from "../provider/model-request.port.js";
import type { CompactionPipeline } from "../compaction/compaction-pipeline.port.js";
import type { RegexConfigService } from "../regex/regex-config.port.js";
import type { AgentRunner } from "./agent.port.js";
import { DefaultAgentRunner } from "./impl/agent-runner.js";

export interface CreateAgentRunnerDeps {
  readonly session: AgentSession;
  readonly modelRequests: ModelRequestService;
  readonly registry: ToolRegistry<VfsToolContext>;
  readonly toolCtx: VfsToolContext;
  /** Required; use {@link createNoOpCompactionPipeline} in tests when compaction is disabled. */
  readonly compaction: CompactionPipeline;
  readonly regexConfig?: RegexConfigService;
  readonly listAllSessionMessages?: () => Promise<readonly ChatMessage[]>;
}

/** Creates an agent runner with injected dependencies. */
export function createAgentRunner(deps: CreateAgentRunnerDeps): AgentRunner {
  return new DefaultAgentRunner(deps);
}

export { createNoOpCompactionPipeline } from "../compaction/create-compaction-pipeline.js";
