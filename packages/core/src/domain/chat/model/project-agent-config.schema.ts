/**
 * {@link ProjectAgentConfig} 的 Zod 校验与 wire 序列化。
 *
 * @module domain/chat/model/project-agent-config.schema
 */

import { z } from "zod";
import { agentDefinitionSchema } from "@/domain/agent/model/agent-definition.schema.js";
import type { ProjectAgentConfig } from "./project-agent-config.js";

const projectAgentModeSchema = z.enum(["follow", "custom"]);

const projectAgentConfigDocumentSchema = z
  .object({
    mode: projectAgentModeSchema,
    definition: agentDefinitionSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === "custom" && value.definition == null) {
      ctx.addIssue({
        code: "custom",
        message: "mode 为 custom 时 definition 必填",
        path: ["definition"],
      });
    }
  });

function configToWire(config: ProjectAgentConfig): Record<string, unknown> {
  return {
    mode: config.mode,
    ...(config.definition != null
      ? { definition: agentDefinitionSchema.toWire(config.definition) }
      : {}),
  };
}

/** 列内 JSON → {@link ProjectAgentConfig}；含 `toWire` 用于持久化。 */
export const projectAgentConfigSchema = Object.assign(
  projectAgentConfigDocumentSchema,
  { toWire: configToWire },
);

export { projectAgentModeSchema };
