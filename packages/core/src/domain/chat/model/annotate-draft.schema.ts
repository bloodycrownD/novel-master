/**
 * 批注回合态草稿（App 模块级会话 Map → `runAgentTurn` 入参）。
 * 不写 `composer_draft_json`；Core 不持有 annotate store。
 *
 * @module domain/chat/model/annotate-draft.schema
 */

import { z } from "zod";

/** 单条未发送批注草稿。 */
export const annotateDraftSchema = z
  .object({
    id: z.string().min(1),
    path: z.string().min(1),
    originalText: z.string(),
    userAnnotation: z.string(),
  })
  .strict();

export type AnnotateDraft = z.infer<typeof annotateDraftSchema>;

/** 批注草稿数组。 */
export const annotateDraftsSchema = z.array(annotateDraftSchema);

export type AnnotateDrafts = z.infer<typeof annotateDraftsSchema>;
