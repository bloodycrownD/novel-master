/**
 * Zod schemas for {@link AgentDefinition} JSON/YAML payloads.
 *
 * @module domain/agent/agent-definition.schema
 */

import { z } from "zod";
import { AgentConfigError } from "@/errors/agent-config-errors.js";
import { validatePromptBlocksFromMap } from "@/domain/prompt/logic/validate-prompt-blocks.js";
import type { PromptBlock } from "@/domain/prompt/model/prompt-block.js";
import type { AgentDefinition, AgentToolPolicy } from "./agent-definition.js";

const textPromptBlockValueSchema = z
  .object({
    type: z.literal("text"),
    role: z.enum(["system", "user", "assistant"]),
    content: z.string(),
    lifecycle: z.enum(["always", "once"]).optional(),
  })
  .strict()
  .superRefine((block, ctx) => {
    if (block.role === "system" && block.lifecycle != null) {
      ctx.addIssue({
        code: "custom",
        message: `system text block must not include lifecycle`,
      });
    }
  });

const chatPromptBlockValueSchema = z
  .object({
    type: z.literal("chat"),
  })
  .strict();

const promptBlockValueSchema = z.union([
  textPromptBlockValueSchema,
  chatPromptBlockValueSchema,
]);

const promptsDocumentSchema = z
  .object({
    blocks: z.record(z.string().min(1), promptBlockValueSchema),
  })
  .strict()
  .superRefine((doc, ctx) => {
    for (const [name, block] of Object.entries(doc.blocks)) {
      const raw = block as { type?: string };
      if (raw.type === "abstract") {
        ctx.addIssue({
          code: "custom",
          message: `prompt block "${name}" uses removed type "abstract"; remove it from agent config`,
        });
      }
    }
  });

const agentToolPolicyDocumentSchema = z
  .object({
    allow: z.array(z.string().min(1)).optional(),
    deny: z.array(z.string().min(1)).optional(),
  })
  .strict();

/** Root agent definition wire document schema (strict ??rejects legacy keys). */
export const agentDefinitionDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().min(1),
    prompts: promptsDocumentSchema,
    model: z.string().min(1).optional(),
    runtime: z
      .object({
        maxSteps: z.number().int().positive().optional(),
        doomLoopThreshold: z.number().int().positive().optional(),
        doomLoopCrossRoundWindow: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    tools: agentToolPolicyDocumentSchema.optional(),
  })
  .strict();

export type AgentDefinitionDocument = z.infer<typeof agentDefinitionDocumentSchema>;

function assertNoLegacyAgentFields(raw: unknown): void {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return;
  }
  const record = raw as Record<string, unknown>;
  if ("preferredModelId" in record) {
    throw new AgentConfigError(
      "INVALID_SCHEMA",
      "preferredModelId is removed; use optional model: <applicationModelId>",
    );
  }
  const model = record.model;
  if (model != null && typeof model === "object" && !Array.isArray(model)) {
    throw new AgentConfigError(
      "INVALID_SCHEMA",
      "legacy nested model block is not supported",
    );
  }
}

function blockToMapValue(
  block: PromptBlock,
): AgentDefinitionDocument["prompts"]["blocks"][string] {
  if (block.type === "text") {
    return {
      type: "text",
      role: block.role,
      content: block.content,
      ...(block.lifecycle === "once" ? { lifecycle: "once" as const } : {}),
    };
  }
  return { type: "chat" };
}

function wireToolsToDomain(
  tools: AgentDefinitionDocument["tools"],
): AgentToolPolicy | undefined {
  if (tools == null) {
    return undefined;
  }
  return {
    ...(tools.allow != null ? { allow: tools.allow } : {}),
    ...(tools.deny != null ? { deny: tools.deny } : {}),
  };
}

function documentToDefinition(doc: AgentDefinitionDocument): AgentDefinition {
  const blocks = validatePromptBlocksFromMap(doc.prompts.blocks);
  const tools = wireToolsToDomain(doc.tools);
  return {
    name: doc.name,
    prompts: blocks,
    model: doc.model,
    runtime: doc.runtime,
    ...(tools != null ? { tools } : {}),
  };
}

function definitionToDocument(def: AgentDefinition): AgentDefinitionDocument {
  const blocks: AgentDefinitionDocument["prompts"]["blocks"] = {};
  for (const block of def.prompts) {
    blocks[block.name] = blockToMapValue(block);
  }
  return {
    schemaVersion: 1,
    name: def.name,
    prompts: { blocks },
    ...(def.model != null ? { model: def.model } : {}),
    ...(def.runtime != null ? { runtime: def.runtime } : {}),
    ...(def.tools != null
      ? {
          tools: {
            ...(def.tools.allow != null
              ? { allow: [...def.tools.allow] }
              : {}),
            ...(def.tools.deny != null ? { deny: [...def.tools.deny] } : {}),
          },
        }
      : {}),
  };
}

const agentDefinitionWireSchema = z.preprocess((raw) => {
  assertNoLegacyAgentFields(raw);
  return raw;
}, agentDefinitionDocumentSchema);

/** Domain parser: wire document ??{@link AgentDefinition}. */
export const agentDefinitionSchema = Object.assign(
  agentDefinitionWireSchema.transform(documentToDefinition),
  { toWire: definitionToDocument },
);

export { promptsDocumentSchema, promptBlockValueSchema };
