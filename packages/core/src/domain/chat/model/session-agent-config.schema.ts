/**
 * {@link SessionAgentConfig} 的 Zod 校验与 wire 序列化。
 *
 * @module domain/chat/model/session-agent-config.schema
 */

import { z } from "zod";
import type { SessionAgentConfig } from "./session-agent-config.js";

const sessionAgentModeSchema = z.enum(["follow", "bind"]);

const sessionAgentConfigDocumentSchema = z
  .union([
    z.object({ mode: z.literal("follow") }).strict(),
    z
      .object({
        mode: z.literal("bind"),
        agentId: z.string().min(1),
        modelId: z.string().min(1).optional(),
      })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    if (value.mode === "bind") {
      if (value.agentId == null || value.agentId.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "mode 为 bind 时 agentId 必填",
          path: ["agentId"],
        });
      }
    }
  });

function configToWire(config: SessionAgentConfig): Record<string, unknown> {
  if (config.mode === "follow") {
    return { mode: "follow" };
  }
  const wire: Record<string, unknown> = {
    mode: "bind",
    agentId: config.agentId,
  };
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

export { sessionAgentModeSchema };
