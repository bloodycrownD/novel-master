/**
 * D6：Desktop 草稿写回透传（带编辑检测）。
 *
 * Desktop 是 webview/textarea Composer，自身不产生也不编辑胶囊区间；它只在
 * 「正文与水化时完全一致」时把持久化的 tokenRanges 原样透传回库，避免跨端
 * 切会话把 mobile 确认的胶囊弄丢。文本已编辑 → 省略字段（`undefined` ≠ `[]`），
 * mobile 侧见到 undefined 才允许兜底扫描一次。
 */

import type { ComposerDraftTokenRange } from '@shared/logic/chat';

/** 水化快照：正文 + 持久化确认区间（`undefined` = 旧草稿，允许兜底扫描）。 */
export type HydratedComposerDraft = {
  readonly text: string;
  readonly tokenRanges?: readonly ComposerDraftTokenRange[];
};

/** 写回 payload（`serializeComposerDraftJson` 的入参；draft attach 恒空）。 */
export type ComposerDraftPersistPayload = {
  readonly text: string;
  readonly attachments: readonly [];
  readonly tokenRanges?: readonly ComposerDraftTokenRange[];
};

/**
 * 组装草稿写回 payload。
 *
 * 仅当 `composerText === 水化文本` 时携带 `tokenRanges`（原样透传，不 remap——
 * desktop 不编辑 ranges）。文本已编辑、尚未水化或水化草稿本身无 ranges（旧草稿）
 * 三种情况都省略该字段；其中 `undefined` 表示「允许 mobile 兜底扫描」，
 * 不能被写成 `[]`（`[]` 表示确认无胶囊、禁止扫描）。
 */
export function resolveComposerDraftPersistPayload(
  hydrated: HydratedComposerDraft | null,
  composerText: string,
): ComposerDraftPersistPayload {
  const base: ComposerDraftPersistPayload = {
    text: composerText,
    attachments: [],
  };
  if (hydrated == null || composerText !== hydrated.text) {
    return base;
  }
  if (hydrated.tokenRanges === undefined) {
    return base;
  }
  return { ...base, tokenRanges: hydrated.tokenRanges };
}
