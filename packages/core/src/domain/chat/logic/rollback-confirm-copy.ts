/**
 * 回滚确认与降级文案（双端共用，避免漂移）。
 *
 * @module domain/chat/logic/rollback-confirm-copy
 */

import { formatRollbackRevisionBackfillAlertMessage } from "@/errors/session-fs-errors.js";

/** 回滚模式：plain user Undo Send 或现网 Rewind。 */
export type RollbackMode = "undo_send" | "rewind";

/** 确认文案种类。 */
export type RollbackConfirmKind = "primary" | "degraded" | "backfill";

/**
 * 解析回滚确认 Alert 正文。
 *
 * @param mode - 由 `isPlainUserUndoSendEligible` 推导的模式
 * @param kind - primary / degraded / backfill
 * @param ctx - backfill 时需提供缺失快照路径
 */
export function resolveRollbackConfirmMessage(
  mode: RollbackMode,
  kind: RollbackConfirmKind,
  ctx?: { missingPaths?: readonly string[] },
): string {
  if (kind === "backfill") {
    return formatRollbackRevisionBackfillAlertMessage(
      ctx?.missingPaths ?? [],
      mode,
    );
  }

  const scope =
    mode === "undo_send"
      ? "将删除此消息**及之后**的对话"
      : "将删除此消息**之后**的对话";

  if (kind === "primary") {
    return `${scope}，并撤销相关文件修改。是否继续？`;
  }

  const degradedScope =
    mode === "undo_send"
      ? "可仅删除此消息**及之后**的对话"
      : "可仅删除此消息**之后**的对话";
  return `${degradedScope}，工作区文件将保持现状。`;
}
