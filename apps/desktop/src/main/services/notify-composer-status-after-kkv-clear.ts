/**
 * session kkv / Undo / 置位压缩后的 Composer 状态条推送。
 *
 * 函数名与参数形状对齐 mobile `refreshComposerStatusAfter*`（scope 对象
 * `{projectId, sessionId}`）；desktop 当前只按 sessionId 路由推送
 * （forwarder 是窗口级广播，无 per-project 状态），projectId 仅随统一
 * 形状透传、不参与判定。文件名保留历史 `notify-` 前缀（渲染器
 * typecheck 基线按路径登记，改名会引入无关基线抖动）。
 *
 * 十七期第2轮签名审计（R1 组4「双端差异参数是否真的被使用」）：runtime 首参
 * 双端都是 `_rt` / `_runtime` 死参（投影真源 `chatAnnotateDraftStore` 是 core
 * 全局单例，推送/落盘才是平台差异），已从本组函数与
 * {@link ProjectComposerStatusService.forSession} 的签名里去掉——「runtime 类型不同
 * 所以不能合并」这条保留理由在投影层不再成立，剩下的是纯平台投递壳。
 *
 * - 置位 / 压缩：project(仅 annotate) 推送；renderer ∪ annotate（禁止终态 `attachments:[]`）。
 * - Undo `undo_send` / `rewind`：推空条（annotate store 的清空见 messages.ts）。
 * - 手动重置：推空条。
 * 不清 composer_draft（正文+attach 保留）。
 */
import { ComposerAttachmentsSuggestForwarder } from "../ipc/forward-composer-attachments-suggest.js";
import { ProjectComposerStatusService } from "./project-composer-status.service.js";

// nm-style 注记：文件名 notify-…-after-kkv-clear 动词/事件前缀，按内容主体起名（ComposerStatusRefresh，
// 语义族对齐 mobile refreshComposerStatusAfter*）；成员保留事件修饰（After*）作区分。
export namespace ComposerStatusRefresh {
  /**
   * Undo rewind / 手动重置 / undo_send：直接空状态条。
   * Renderer 侧仍会 ∪ annotate store（若有）。
   */
  export async function afterSessionKkvCleared(scope: {readonly projectId: string; readonly sessionId: string}): Promise<void> {
    ComposerAttachmentsSuggestForwarder.notify({
      sessionId: scope.sessionId,
      attachments: [],
    });
  }

  /**
   * 置位 / 压缩成功：project(仅 annotate) 推送；终态非强制 `[]`。
   * Annotate chip 由 renderer `unionComposerStatusWithAnnotate` 合并。
   * （Undo undo_send / rewind 走 {@link afterSessionKkvCleared} 推空。）
   */
  export async function afterFloorOrCompaction(scope: {readonly projectId: string; readonly sessionId: string}): Promise<void> {
    const attachments = await ProjectComposerStatusService.forSession(scope.sessionId);
    ComposerAttachmentsSuggestForwarder.notify({
      sessionId: scope.sessionId,
      attachments,
    });
  }
}
