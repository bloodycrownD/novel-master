/**
 * session kkv / Undo / 置位压缩后的 Composer 状态条推送。
 *
 * - 置位 / 压缩：project(ops) 推送；renderer ∪ annotate（禁止终态 `attachments:[]`）。
 * - Undo `undo_send`：main 已 parse→写 log store 后走 project 推 ops（见 messages.ts）。
 * - Undo `rewind` / 手动重置：推空条；手动重置须先 clearUserOpsLog。
 * 不清 composer_draft（正文+attach 保留）。
 */
import { notifyComposerAttachmentsSuggestToRenderer } from "../ipc/forward-composer-attachments-suggest.js";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import { projectComposerStatusForSession } from "./project-composer-status.service.js";

/**
 * Undo rewind / 手动重置：直接空状态条。
 * Renderer 侧仍会 ∪ annotate store（若有）；禁止以此 wipe main 已推的 undo_send ops
 *（undo_send 请走 {@link notifyComposerStatusAfterFloorOrCompaction}）。
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
 * 置位 / 压缩 / Undo undo_send 成功：project(ops) 推送；终态非强制 `[]`。
 * Annotate chip 由 renderer `unionComposerStatusWithAnnotate` 合并。
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
