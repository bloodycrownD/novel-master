/**
 * Zod schemas for {@link AgentDefinition} JSON/YAML payloads.
 *
 * @module domain/agent/agent-definition.schema
 */

import { z } from "zod";
import { AgentConfigError } from "@/errors/agent-config-errors.js";
import {
  dynamicBlockToWire,
  persistBlockToWire,
} from "@/domain/prompt/logic/agent-prompt-layout-wire.js";
import { validateAgentPromptLayoutFromMaps } from "@/domain/prompt/logic/validate-agent-prompt-layout.js";
import { stripLegacyWorktreeBlocksFromPersistMap } from "@/domain/prompt/logic/normalize-agent-prompt-layout.js";
import type { AgentDefinition, AgentToolPolicy } from "./agent-definition.js";

const persistTextBlockValueSchema = z
  .object({
    type: z.literal("text"),
    role: z.enum(["user", "assistant"]),
    content: z.string(),
  })
  .strict();

const persistBlockValueSchema = persistTextBlockValueSchema;

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

function stripLegacyWorktreeFromPromptsWire(raw: unknown): unknown {
  const rejected = rejectLegacyPromptKeys(raw);
  if (
    rejected == null ||
    typeof rejected !== "object" ||
    Array.isArray(rejected)
  ) {
    return rejected;
  }
  const record = rejected as Record<string, unknown>;
  const persist = record.persist;
  if (persist == null || typeof persist !== "object" || Array.isArray(persist)) {
    return rejected;
  }
  return {
    ...record,
    persist: stripLegacyWorktreeBlocksFromPersistMap(
      persist as Record<string, unknown>,
    ),
  };
}

const promptsDocumentSchema = z.preprocess(
  stripLegacyWorktreeFromPromptsWire,
  z
    .object({
      system: z.string().optional(),
      persist: z.record(z.string().min(1), persistBlockValueSchema).default({}),
      dynamic: z.record(z.string().min(1), dynamicTextBlockValueSchema).default({}),
      persistEnabled: z.boolean().default(false),
      dynamicEnabled: z.boolean().default(false),
      workplace: z.boolean().optional(),
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
    model: z.string().uuid().optional(),
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
      "preferredModelId is removed; use optional model: <savedModelId UUID>",
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
    {
      persistEnabled: doc.prompts.persistEnabled,
      dynamicEnabled: doc.prompts.dynamicEnabled,
      workplace: doc.prompts.workplace,
    },
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
      persistEnabled: def.prompts.persistEnabled ?? false,
      dynamicEnabled: def.prompts.dynamicEnabled ?? false,
      ...(def.prompts.workplace === true ? { workplace: true } : {}),
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
