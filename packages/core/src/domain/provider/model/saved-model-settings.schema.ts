/**
 * {@link SavedModelSettings} JSON 文档的 Zod schema（v1 读兼容 + v2 canonical）。
 *
 * @module domain/provider/model/saved-model-settings.schema
 */

import { z } from "zod";
import {
  isValidTokenCounterModePref,
  parseTokenCounterModePref,
} from "@/infra/tokenizer/logic/read-token-counter-mode-pref.js";
import { modelSamplingParamsSchema } from "./model-sampling-params.schema.js";
import type { SavedModelSettings, ThinkingLevel } from "./saved-model-settings.js";

const savedModelSamplingSettingsSchema = z
  .object({
    enabled: z.boolean(),
    params: modelSamplingParamsSchema.optional(),
  })
  .strict();

/** 思考强度档位枚举（持久化 canonical）。 */
export const thinkingLevelSchema = z.enum(["off", "low", "medium", "high"]);

/**
 * dev-only：将未发布的 `thinking.enabled` 形态映射为 `thinkingLevel`。
 * 不写入 v1.2.7 用户迁移义务；仅减轻本地 dev 库残留。
 */
function normalizeGenerationForRead(raw: unknown): unknown {
  if (typeof raw !== "object" || raw == null) {
    return raw;
  }
  const generation = raw as Record<string, unknown>;
  if ("thinkingLevel" in generation) {
    return raw;
  }
  const thinking = generation.thinking;
  if (typeof thinking !== "object" || thinking == null || !("enabled" in thinking)) {
    return raw;
  }
  const enabled = (thinking as { enabled: boolean }).enabled;
  const { thinking: _removed, ...rest } = generation;
  const thinkingLevel: ThinkingLevel = enabled ? "medium" : "off";
  return { ...rest, thinkingLevel };
}

const savedModelGenerationSettingsSchema = z.preprocess(
  normalizeGenerationForRead,
  z
    .object({
      sampling: savedModelSamplingSettingsSchema,
      thinkingLevel: thinkingLevelSchema.default("off"),
    })
    .strict(),
);

const tokenCounterModeSchema = z
  .string()
  .default("auto")
  .refine(isValidTokenCounterModePref, { message: "Invalid tokenCounterMode" })
  .transform((raw) => parseTokenCounterModePref(raw));

const savedModelInternalSettingsSchema = z
  .object({
    contextWindowTokens: z.number().int().positive(),
    tokenCounterMode: tokenCounterModeSchema,
  })
  .strict();

/** v2 canonical 文档形态（写盘输出）。 */
export const savedModelSettingsV2DocumentSchema = z
  .object({
    schemaVersion: z.literal(2),
    internal: savedModelInternalSettingsSchema,
    generation: savedModelGenerationSettingsSchema,
  })
  .strict();

export type SavedModelSettingsDocument = z.infer<
  typeof savedModelSettingsV2DocumentSchema
>;

/** v1 扁平文档 → v2 内存形态。 */
const savedModelSettingsV1DocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    contextWindowTokens: z.number().int().positive(),
    sampling: savedModelSamplingSettingsSchema,
    tokenCounterMode: tokenCounterModeSchema,
  })
  .strict()
  .transform(
    (doc): SavedModelSettings => ({
      schemaVersion: 2,
      internal: {
        contextWindowTokens: doc.contextWindowTokens,
        tokenCounterMode: doc.tokenCounterMode,
      },
      generation: {
        sampling: doc.sampling,
        thinkingLevel: "off",
      },
    }),
  );

const savedModelSettingsV2ToMemorySchema = savedModelSettingsV2DocumentSchema.transform(
  (doc): SavedModelSettings => ({
    schemaVersion: 2,
    internal: doc.internal,
    generation: doc.generation,
  }),
);

/** 读盘：接受 v1 或 v2 文档，输出 v2 内存形态。 */
export const savedModelSettingsSchema = z.union([
  savedModelSettingsV1DocumentSchema,
  savedModelSettingsV2ToMemorySchema,
]);

/** @deprecated 使用 {@link savedModelSettingsSchema}；保留别名供旧引用。 */
export const savedModelSettingsDocumentSchema = savedModelSettingsSchema;
