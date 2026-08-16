/**
 * session kkv / Undo / 置位压缩后的 Composer 状态条推送。
 *
 * - 置位 / 压缩：project(仅 annotate) 推送；renderer ∪ annotate（禁止终态 `attachments:[]`）。
 * - Undo `undo_send` / `rewind`：推空条（annotate store 的清空见 messages.ts）。
 * - 手动重置：推空条。
 * 不清 composer_draft（正文+attach 保留）。
 */
import { notifyComposerAttachmentsSuggestToRenderer } from "../ipc/forward-composer-attachments-suggest.js";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import { projectComposerStatusForSession } from "./project-composer-status.service.js";

/**
 * Undo rewind / 手动重置 / undo_send：直接空状态条。
 * Renderer 侧仍会 ∪ annotate store（若有）。
 */
export async function notifyComposerStatusAfterSessionKkvCleared(
  _rt: DesktopNovelMasterRuntime,
  sessionId: string,
): Promise<void> {
  notifyComposerAttachmentsSuggestToRenderer({
    sessionId,
    attachments: [],
  });
}

/**
 * 置位 / 压缩成功：project(仅 annotate) 推送；终态非强制 `[]`。
 * Annotate chip 由 renderer `unionComposerStatusWithAnnotate` 合并。
 * （Undo undo_send / rewind 走 {@link notifyComposerStatusAfterSessionKkvCleared} 推空。）
 */
export async function notifyComposerStatusAfterFloorOrCompaction(
  rt: DesktopNovelMasterRuntime,
  sessionId: string,
): Promise<void> {
  const attachments = await projectComposerStatusForSession(rt, sessionId);
  notifyComposerAttachmentsSuggestToRenderer({
    sessionId,
    attachments,
  });
}
