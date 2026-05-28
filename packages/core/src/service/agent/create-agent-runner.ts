/**
 * Factory for {@link DefaultAgentRunner}.
 *
 * @module service/agent/create-agent-runner
 */

import type { AgentSession } from "@/domain/agent/agent-session.port.js";
import type { ToolRegistry } from "@/domain/tool/tool-registry.js";
import type { VfsToolContext } from "@/domain/tool/builtin/vfs-tools.js";
import type { ModelRequestService } from "../provider/model-request.port.js";
import type { CompactionService } from "../compaction/compaction.port.js";
import type { AgentRunner } from "./agent.port.js";
import { DefaultAgentRunner } from "./impl/agent-runner.js";

export interface CreateAgentRunnerDeps {
  readonly session: AgentSession;
  readonly modelRequests: ModelRequestService;
  readonly registry: ToolRegistry<VfsToolContext>;
  readonly toolCtx: VfsToolContext;
  readonly compaction: CompactionService;
}

/** Creates an agent runner with injected dependencies. */
export function createAgentRunner(deps: CreateAgentRunnerDeps): AgentRunner {
  return new DefaultAgentRunner(deps);
}
