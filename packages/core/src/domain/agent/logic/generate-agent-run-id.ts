/**
 * Agent run 唯一标识生成（仅 Core agent-runner 调用）。
 *
 * @module domain/agent/logic/generate-agent-run-id
 */

import { randomUUID } from "@/infra/random-uuid.js";

/** 生成单次 agent run 的 `runId`（RFC4122 v4）。 */
export function generateAgentRunId(): string {
  return randomUUID();
}
