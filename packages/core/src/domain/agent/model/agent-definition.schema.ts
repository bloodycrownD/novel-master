/**
 * Zod schemas for {@link AgentDefinition} JSON/YAML payloads.
 *
 * @module domain/agent/agent-definition.schema
 */

import { z } from "zod";
import { AgentConfigError } from "@/errors/agent-config-errors.js";
import { validateAgentPromptLayoutFromMaps } from "@/domain/prompt/logic/validate-agent-prompt-layout.js";
import type { AgentPromptLayout } from "@/domain/prompt/model/agent-prompt-layout.js";
import type { AgentDefinition, AgentToolPolicy } from "./agent-definition.js";

const persistTextBlockValueSchema = z
  .object({
    type: z.literal("text"),
    role: z.enum(["user", "assistant"]),
    content: z.string(),
  })
  .strict();

const persistWorktreeBlockValueSchema = z
  .object({
    type: z.literal("worktree"),
  })
  .strict();

const persistBlockValueSchema = z.union([
  persistTextBlockValueSchema,
  persistWorktreeBlockValueSchema,
]);

const dynamicTextBlockValueSchema = z
  .object({
    type: z.literal("text"),
    role: z.enum(["user", "assistant"]),
    content: z.string(),
    lifecycle: z.enum(["always", "once"]).optional(),
  })
  .strict();

function rejectLegacyPromptKeys(raw: unknown): unknown {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return raw;
  }
  const record = raw as Record<string, unknown>;
  if ("blocks" in record) {
    throw new AgentConfigError(
      "INVALID_SCHEMA",
      "prompts.blocks is removed; use prompts.system / persist / dynamic",
    );
  }
  if ("regions" in record) {
    throw new AgentConfigError(
      "INVALID_SCHEMA",
      "prompts.regions is not supported; use prompts.system / persist / dynamic",
    );
  }
  if ("chat" in record) {
    throw new AgentConfigError(
      "INVALID_SCHEMA",
      "prompts.chat is not supported; chat is a runtime slot only",
    );
  }
  return raw;
}

const promptsDocumentSchema = z.preprocess(
  rejectLegacyPromptKeys,
  z
    .object({
      system: z.string().optional(),
      persist: z.record(z.string().min(1), persistBlockValueSchema).default({}),
      dynamic: z.record(z.string().min(1), dynamicTextBlockValueSchema).default({}),
    })
    .strict(),
);

const agentToolPolicyDocumentSchema = z
  .object({
    allow: z.array(z.string().min(1)).optional(),
    deny: z.array(z.string().min(1)).optional(),
  })
  .strict();

/** Root agent definition wire document schema (strict — rejects legacy keys). */
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

function persistBlockToWire(
  block: AgentPromptLayout["persist"][number],
): AgentDefinitionDocument["prompts"]["persist"][string] {
  if (block.type === "worktree") {
    return { type: "worktree" };
  }
  return {
    type: "text",
    role: block.role,
    content: block.content,
  };
}

function dynamicBlockToWire(
  block: AgentPromptLayout["dynamic"][number],
): AgentDefinitionDocument["prompts"]["dynamic"][string] {
  return {
    type: "text",
    role: block.role,
    content: block.content,
    ...(block.lifecycle === "once" ? { lifecycle: "once" as const } : {}),
  };
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
  const prompts = validateAgentPromptLayoutFromMaps(
    doc.prompts.persist,
    doc.prompts.dynamic,
    doc.prompts.system,
  );
  const tools = wireToolsToDomain(doc.tools);
  return {
    name: doc.name,
    prompts,
    model: doc.model,
    runtime: doc.runtime,
    ...(tools != null ? { tools } : {}),
  };
}

function definitionToDocument(def: AgentDefinition): AgentDefinitionDocument {
  const persist: AgentDefinitionDocument["prompts"]["persist"] = {};
  for (const block of def.prompts.persist) {
    persist[block.name] = persistBlockToWire(block);
  }
  const dynamic: AgentDefinitionDocument["prompts"]["dynamic"] = {};
  for (const block of def.prompts.dynamic) {
    dynamic[block.name] = dynamicBlockToWire(block);
  }
  return {
    schemaVersion: 1,
    name: def.name,
    prompts: {
      ...(def.prompts.system != null ? { system: def.prompts.system } : {}),
      persist,
      dynamic,
    },
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

/** Domain parser: wire document → {@link AgentDefinition}. */
export const agentDefinitionSchema = Object.assign(
  agentDefinitionWireSchema.transform(documentToDefinition),
  { toWire: definitionToDocument },
);

export {
  promptsDocumentSchema,
  persistBlockValueSchema,
  dynamicTextBlockValueSchema,
};
