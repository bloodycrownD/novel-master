/**
 * {@link SessionAgentConfig} 的 Zod 校验与 wire 序列化。
 *
 * @module domain/chat/model/session-agent-config.schema
 */

import { z } from "zod";
import type { SessionAgentConfig } from "./session-agent-config.js";

const sessionAgentConfigDocumentSchema = z
  .object({
    agentId: z.string().min(1),
    modelId: z.string().min(1).optional(),
  })
  .strict();

function configToWire(config: SessionAgentConfig): Record<string, unknown> {
  const wire: Record<string, unknown> = { agentId: config.agentId };
  if (config.modelId != null) {
    wire.modelId = config.modelId;
  }
  return wire;
}

/** 列内 JSON → {@link SessionAgentConfig}；含 `toWire` 用于持久化。 */
export const sessionAgentConfigSchema = Object.assign(
  sessionAgentConfigDocumentSchema,
  { toWire: configToWire },
);
