/**
 * 会话 scope 用户 VFS 操作经 UserVfsTurnService 执行（pending，不 markDirty）。
 *
 * @module services/user-vfs-turn-execute.service
 */
import { type UserVfsTurnOp } from "@novel-master/core/chat";
import { isSessionVfsScope } from "@novel-master/core/vfs";
import { Result } from "@novel-master/core/errors";
import { ComposerAttachmentsSuggestForwarder } from "../ipc/forward-composer-attachments-suggest.js";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import { projectComposerStatusForSession } from "./project-composer-status.service.js";

// 类型窄化本体在 core（VfsScope 定义处）；这里转出给 handlers/vfs.ts 与 vfs-batch 沿用既有 import 面。
export { isSessionVfsScope };

/**
 * 经 userVfsTurn 执行；失败沿 `Result` 返回，由调用方转码（handlers/vfs.ts 各
 * handler 的 `ipcErr(formatIpcError(...))`；vfs-batch 侧经 core BatchIngestWriter
 * 协议聚进 Report.failed——错误通道迁移七期起 writer 端口收
 * `Result<void, AppError>`）。错误侧照 core port 契约保持
 * `unknown`（`user-vfs-turn.port.ts` 的 UserVfsTurnExecuteResult：合成 tool 失败
 * 是异构形态），转码统一走 formatIpcError。成功后轻量 refresh：读 main 侧
 * annotate store 投影推送（无净 diff preview）。
 */
export async function executeSessionUserVfsOp(rt: DesktopNovelMasterRuntime, sessionId: string, op: UserVfsTurnOp): Promise<Result<void, unknown>> {
  const result = await rt.userVfsTurn.executeOp(sessionId, op);
  if (!result.ok) return Result.err(result.error);
  const attachments = await projectComposerStatusForSession(rt, sessionId);
  ComposerAttachmentsSuggestForwarder.notify({
    sessionId,
    attachments,
  });
  return Result.ok(undefined);
}
