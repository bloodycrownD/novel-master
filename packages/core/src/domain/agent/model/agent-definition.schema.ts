/**
 * Zod schemas for {@link AgentDefinition} JSON/YAML payloads.
 *
 * @module domain/agent/agent-definition.schema
 */

import { z } from "zod";
import { dynamicBlockToWire, persistBlockToWire } from "@/domain/prompt/logic/agent-prompt-layout-wire.js";
import { validateAgentPromptLayout, validateAgentPromptLayoutFromMaps } from "@/domain/prompt/logic/validate-agent-prompt-layout.js";
import { stripLegacyAgentWire, stripLegacyPrompts, stripLifecycleFromTextBlock } from "./agent-definition-preprocess.js";
import type { AgentDefinition } from "./agent-definition.js";

/**
 * 文本块 wire 值 schema：剥 lifecycle 键后 strict 解析。
 *
 * @remarks 常驻开关下线后 dynamic 一律 once 语义，persist 恒无该字段。存量定义
 * （`lifecycle:"once"` / `"always"` / 非法值）一律静默剥键照常 decode，不拒载、不迁移；
 * 与 raw-map 校验层（`validate-agent-prompt-layout`）同为 strip 语义，避免双入口分歧。
 * persist 与 dynamic 两区文本块形态一致（type/role/content），共用本常量。
 */
const textBlockStrictSchema = z.object({ type: z.literal("text"), role: z.enum(["user", "assistant"]), content: z.string() }).strict();

const textBlockValueSchema = z.preprocess(stripLifecycleFromTextBlock, textBlockStrictSchema);

const promptsWorkplaceSchema = z.union([z.boolean(), z.string().refine((s) => s.trim().length > 0, { message: "prompts.workplace 如开启则须为非空字符串" })]).optional();
const promptsCustomAttachSchema = z.string().refine((s) => s.trim().length > 0, { message: "prompts.customAttach 如填写则须为非空字符串" }).optional();
const promptsSkillsPrefixSchema = z.string().refine((s) => s.trim().length > 0, { message: "prompts.skillsPrefix 如填写则须为非空字符串" }).optional();

const promptsObjectShape = {
  system: z.string().optional(),
  persist: z.record(z.string().min(1), textBlockValueSchema).default({}),
  dynamic: z.record(z.string().min(1), textBlockValueSchema).default({}),
  persistEnabled: z.boolean().default(false),
  dynamicEnabled: z.boolean().default(false),
  /** wire：关 omit；开为非空 string；兼容旧 `true`（空串 / 仅空白非法）。 */
  workplace: promptsWorkplaceSchema,
  /** wire：关 omit；开为 trim 后非空 string（新字段，无历史值，无需 boolean 兼容）。 */
  customAttach: promptsCustomAttachSchema,
  /** 技能能力总开关：wire 缺省 = 开；仅显式 false 表示关闭。 */
  skillsEnabled: z.boolean().optional(),
  /** 技能索引前缀语：wire 缺省/空 = 默认前缀；trim 后须非空。 */
  skillsPrefix: promptsSkillsPrefixSchema,
};

const promptsObjectSchema = z.object(promptsObjectShape).strict();

export const promptsDocumentSchema = z.preprocess(stripLegacyPrompts, promptsObjectSchema);

const agentToolPolicyDocumentSchema = z.object({ allow: z.array(z.string().min(1)).optional(), deny: z.array(z.string().min(1)).optional() }).strict();

const agentRuntimeShape = {
  maxSteps: z.number().int().positive().optional(),
  doomLoopThreshold: z.number().int().positive().optional(),
  doomLoopCrossRoundWindow: z.number().int().positive().optional(),
};

const agentRuntimeSchema = z.object(agentRuntimeShape).strict().optional();

const agentDefinitionDocumentShape = {
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  description: z.string().optional(),
  /** 暴露范围：缺省按 "all" 解释（消费侧 fallback）。 */
  mode: z.enum(["primary", "subagent", "all"]).optional(),
  prompts: promptsDocumentSchema,
  model: z.string().uuid().optional(),
  runtime: agentRuntimeSchema,
  tools: agentToolPolicyDocumentSchema.optional(),
};

/** Root agent definition wire document schema (strict — rejects legacy keys). */
export const agentDefinitionDocumentSchema = z.object(agentDefinitionDocumentShape).strict();

type AgentDefinitionDocument = z.infer<typeof agentDefinitionDocumentSchema>;

const agentDefinitionWireSchema = z.preprocess(stripLegacyAgentWire, agentDefinitionDocumentSchema);

/** Domain parser: wire document → {@link AgentDefinition}（toWire 由下面的 {@link agentDefinitionSchema} 挂载）。 */
const agentDefinitionBaseSchema = agentDefinitionWireSchema.transform((doc) => {
  const prompts = validateAgentPromptLayoutFromMaps(doc.prompts.persist, doc.prompts.dynamic, doc.prompts.system, {
    persistEnabled: doc.prompts.persistEnabled,
    dynamicEnabled: doc.prompts.dynamicEnabled,
    workplace: doc.prompts.workplace,
    customAttach: doc.prompts.customAttach,
    skillsEnabled: doc.prompts.skillsEnabled,
    skillsPrefix: doc.prompts.skillsPrefix,
  });
  if (!prompts.ok) throw prompts.error;
  return {
    name: doc.name,
    ...(doc.description != null && doc.description.length > 0 ? { description: doc.description } : {}),
    ...(doc.mode != null ? { mode: doc.mode } : {}),
    prompts: prompts.value,
    model: doc.model,
    runtime: doc.runtime,
    ...(doc.tools != null ? { tools: doc.tools } : {}),
  };
});

/** Domain parser + serializer（decode / encode 共用）。 */
export const agentDefinitionSchema = Object.assign(agentDefinitionBaseSchema, {
  toWire: (def: AgentDefinition): AgentDefinitionDocument => {
    // 块名唯一性门禁（RT-04）：wire 形态是「块名 → 块」的对象映射，同名块在这里
    // 会被后写静默覆盖（正文永久丢失、零报错）。读侧 validateAgentPromptLayoutFromMaps
    // 天然唯一、写侧此前是裸的 ⇒ 只补写侧这一处。
    // 落点选这里而不是 configToWire：toWire 的三个调用点（validateAgentDefinition /
    // ProjectAgentConfig.updateAgentConfig / 注册表持久化）唯一收敛在 toWire，
    // 一处改动全覆盖，同一条规则插两遍将来必漏改一处。
    const validated = validateAgentPromptLayout(def.prompts);
    if (!validated.ok) throw validated.error;
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
      ...(def.description != null && def.description.trim().length > 0 ? { description: def.description } : {}),
      ...(def.mode != null ? { mode: def.mode } : {}),
      prompts: {
        ...(def.prompts.system != null ? { system: def.prompts.system } : {}),
        persistEnabled: def.prompts.persistEnabled ?? false,
        dynamicEnabled: def.prompts.dynamicEnabled ?? false,
        ...(typeof def.prompts.workplace === "string" && def.prompts.workplace.length > 0 ? { workplace: def.prompts.workplace } : {}),
        ...(typeof def.prompts.customAttach === "string" && def.prompts.customAttach.trim().length > 0 ? { customAttach: def.prompts.customAttach } : {}),
        ...(def.prompts.skillsEnabled === false ? { skillsEnabled: false } : {}),
        ...(typeof def.prompts.skillsPrefix === "string" && def.prompts.skillsPrefix.trim().length > 0 ? { skillsPrefix: def.prompts.skillsPrefix } : {}),
        persist,
        dynamic,
      },
      ...(def.model != null ? { model: def.model } : {}),
      ...(def.runtime != null ? { runtime: def.runtime } : {}),
      ...(def.tools != null
        ? {
            tools: {
              ...(def.tools.allow != null ? { allow: [...def.tools.allow] } : {}),
              ...(def.tools.deny != null ? { deny: [...def.tools.deny] } : {}),
            },
          }
        : {}),
    };
  },
});
