/**
 * session kkv / Undo / 置位压缩后的 Composer 状态条推送。
 *
 * 函数名与参数形状对齐 mobile `refreshComposerStatusAfter*`（scope 对象
 * `{projectId, sessionId}`）；desktop 当前只按 sessionId 路由推送
 * （forwarder 是窗口级广播，无 per-project 状态），projectId 仅随统一
 * 形状透传、不参与判定。文件名保留历史 `notify-` 前缀（渲染器
 * typecheck 基线按路径登记，改名会引入无关基线抖动）。
 *
 * - 置位 / 压缩：project(仅 annotate) 推送；renderer ∪ annotate（禁止终态 `attachments:[]`）。
 * - Undo `undo_send` / `rewind`：推空条（annotate store 的清空见 messages.ts）。
 * - 手动重置：推空条。
 * 不清 composer_draft（正文+attach 保留）。
 */
import { ComposerAttachmentsSuggestForwarder } from "../ipc/forward-composer-attachments-suggest.js";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import { projectComposerStatusForSession } from "./project-composer-status.service.js";

/**
 * Undo rewind / 手动重置 / undo_send：直接空状态条。
 * Renderer 侧仍会 ∪ annotate store（若有）。
 */
export async function refreshComposerStatusAfterSessionKkvCleared(_rt: DesktopNovelMasterRuntime, scope: {readonly projectId: string; readonly sessionId: string}): Promise<void> {
  ComposerAttachmentsSuggestForwarder.notify({
    sessionId: scope.sessionId,
    attachments: [],
  });
}

/**
 * 置位 / 压缩成功：project(仅 annotate) 推送；终态非强制 `[]`。
 * Annotate chip 由 renderer `unionComposerStatusWithAnnotate` 合并。
 * （Undo undo_send / rewind 走 {@link refreshComposerStatusAfterSessionKkvCleared} 推空。）
 */
export async function refreshComposerStatusAfterFloorOrCompaction(rt: DesktopNovelMasterRuntime, scope: {readonly projectId: string; readonly sessionId: string}): Promise<void> {
  const attachments = await projectComposerStatusForSession(rt, scope.sessionId);
  ComposerAttachmentsSuggestForwarder.notify({
    sessionId: scope.sessionId,
    attachments,
  });
}
