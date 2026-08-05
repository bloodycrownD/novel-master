/**
 * Zod schema for `agents.yaml` multi-agent bundle documents (CLI exchange format).
 *
 * @module agent/schemas/agents-bundle.schema
 */

import { z } from "zod";
import { promptsDocumentSchema } from "@novel-master/core/agent";

/** Bundle 内单条 agent 的工具策略（与 core wire schema 同构）。 */
const agentBundleToolPolicySchema = z
  .object({
    allow: z.array(z.string().min(1)).optional(),
    deny: z.array(z.string().min(1)).optional(),
  })
  .strict();

const agentBundleEntrySchema = z
  .object({
    prompts: promptsDocumentSchema,
    model: z.string().min(1).optional(),
    runtime: z.object({ maxSteps: z.number().int().positive().optional() }).strict().optional(),
    /** 可选工具 allow/deny 策略（缺省：全部注册工具）。旧 bundle 无此字段仍可导入。 */
    tools: agentBundleToolPolicySchema.optional(),
    /** 是否可被 `task` 工具调用；缺省按 `false` 处理。 */
    subagentCallable: z.boolean().optional(),
    /** 人类可读的 agent 描述（用于向主代理介绍本 agent 的能力）。 */
    description: z.string().optional(),
  })
  .strict();

/** Root agents bundle document (`agents` map keys = agentId). */
export const agentsBundleDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    agents: z.record(z.string().min(1), agentBundleEntrySchema),
  })
  .strict();

export type AgentsBundleDocument = z.infer<typeof agentsBundleDocumentSchema>;

/** True when raw object is a multi-agent bundle (not a single-agent root doc). */
export function isAgentsBundleDocument(raw: unknown): boolean {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return false;
  }
  const record = raw as Record<string, unknown>;
  return (
    record.schemaVersion === 1 &&
    record.agents != null &&
    typeof record.agents === "object"
  );
}
