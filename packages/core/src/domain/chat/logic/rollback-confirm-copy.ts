/**
 * 回滚确认与降级文案描述。
 *
 * 只产出 descriptor（key + params），不包含文案、不依赖 locale；由 UI 用 JSON
 * catalog + `createTranslator` 渲染。
 *
 * @module domain/chat/logic/rollback-confirm-copy
 */

import type { ChatMessageDescriptor } from "../i18n/keys.js";

/** 回滚模式：plain user Undo Send 或现网 Rewind。 */
export type RollbackMode = "undo_send" | "rewind";

/** 确认文案种类。 */
export type RollbackConfirmKind = "primary" | "degraded" | "backfill";

type RollbackConfirmKey =
  | "chat.rollback.confirm.primary.undo_send"
  | "chat.rollback.confirm.primary.rewind"
  | "chat.rollback.confirm.degraded.undo_send"
  | "chat.rollback.confirm.degraded.rewind"
  | "chat.rollback.confirm.backfill";

export type RollbackConfirmDescriptor = ChatMessageDescriptor & { readonly key: RollbackConfirmKey };

const ROLLBACK_CONFIRM_KEYS = {
  primary: {
    undo_send: "chat.rollback.confirm.primary.undo_send",
    rewind: "chat.rollback.confirm.primary.rewind",
  },
  degraded: {
    undo_send: "chat.rollback.confirm.degraded.undo_send",
    rewind: "chat.rollback.confirm.degraded.rewind",
  },
} as const satisfies Record<"primary" | "degraded", Record<RollbackMode, RollbackConfirmKey>>;

/**
 * 解析回滚确认 Alert 的 descriptor。
 *
 * @param mode - 由 `ChatMessageEntity.isUndoSendEligible()` 推导的模式
 * @param kind - primary / degraded / backfill
 * @param ctx - backfill 时需提供缺失快照路径
 */
export function rollbackConfirmDescriptor(mode: RollbackMode, kind: RollbackConfirmKind, ctx?: { missingPaths?: readonly string[] }): RollbackConfirmDescriptor {
  if (kind === "backfill") {
    const missingPaths = ctx?.missingPaths ?? [];
    const files: ChatMessageDescriptor[] = [];
    if (missingPaths.length === 0) {
      files.push({ key: "chat.rollback.confirm.backfill.file.empty" });
    } else {
      for (const path of missingPaths) {
        files.push({ key: "chat.rollback.confirm.backfill.file", params: { path: path.startsWith("/") ? path.slice(1) : path } });
      }
    }
    const tailKey = mode === "undo_send" ? "chat.rollback.confirm.backfill.tail.undo_send" : "chat.rollback.confirm.backfill.tail.rewind";
    return { key: "chat.rollback.confirm.backfill", params: { files, tail: { key: tailKey } } };
  }
  return { key: ROLLBACK_CONFIRM_KEYS[kind][mode] };
}
