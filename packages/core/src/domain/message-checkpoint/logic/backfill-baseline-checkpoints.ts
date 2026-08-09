/**
 * 导入（角色卡 / ZIP）完成后，给「最后一个有 checkpoint 的消息之后」
 * 的空窗消息补一条 baseline checkpoint，指向当前工作区的 live file heads。
 *
 * 例如：消息 3 有 checkpoint，消息 6 时导入 → 只补 4、5、6。
 * 3 及之前不碰（它们已经有自己的 checkpoint 语义）。
 *
 * @module domain/message-checkpoint/logic/backfill-baseline-checkpoints
 */

import { listSessionFileHeads } from "./list-session-files.js";
import type { MessageCheckpointRepository } from "../repositories/message-checkpoint.port.js";
import type { MessageRepository } from "@/domain/chat/repositories/message.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { IntegrityRepairOperation } from "@/service/integrity-repair.js";

/**
 * 从最后一个有 checkpoint 的消息之后，给所有空窗消息补 baseline 快照。
 *
 * - 已有 checkpoint 的消息不受影响（不会被覆盖）。
 * - 如果会话里没有任何 checkpoint，则从第一条消息开始全部补。
 * - 没有任何 message 或没有任何 live 文件时是空操作。
 */
export async function backfillBaselineCheckpoints(
  entryRepo: VfsEntryRepository,
  messageRepo: MessageRepository,
  checkpointRepo: MessageCheckpointRepository,
  projectId: string,
  sessionId: string,
): Promise<void> {
  const files = await listSessionFileHeads(entryRepo, projectId, sessionId);
  if (files.length === 0) {
    return;
  }

  const messages = await messageRepo.listBySession(sessionId);
  if (messages.length === 0) {
    return;
  }

  // 倒序找到最后一个有 checkpoint 的消息位置，它之后的都是需要补的空窗。
  // 如果没有任何 checkpoint，整个列表都是空窗（从头补）。
  let firstGapIndex = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const has = await checkpointRepo.hasCheckpoint(sessionId, messages[i]!.id);
    if (has) {
      firstGapIndex = i + 1;
      break;
    }
  }

  if (firstGapIndex >= messages.length) {
    return;
  }

  const now = Date.now();
  const filePointers = files.map((f) => ({
    entryId: f.entryId,
    revisionVersion: f.headVersion,
  }));

  for (let i = firstGapIndex; i < messages.length; i++) {
    await checkpointRepo.insertCheckpoint({
      sessionId,
      messageId: messages[i]!.id,
      createdAtMs: now,
      files: filePointers,
    });
  }
}

/**
 * 把 {@link backfillBaselineCheckpoints} 包成 `backfill` 类型的 {@link IntegrityRepairOperation}。
 *
 * detect 复用 backfill 内部的「找空窗」逻辑（只读不写）：
 * - 没消息 / 没 live 文件 → needsRepair=false；
 * - 最后一条有 checkpoint 的消息之后没有空窗 → needsRepair=false；
 * - 存在空窗 → needsRepair=true，details 给出空窗起止位置。
 *
 * repair 直接调用 {@link backfillBaselineCheckpoints}，幂等安全（已有 checkpoint 不会被覆盖）。
 */
export function createBaselineCheckpointBackfillOperation(args: {
  readonly entryRepo: VfsEntryRepository;
  readonly messageRepo: MessageRepository;
  readonly checkpointRepo: MessageCheckpointRepository;
  readonly projectId: string;
  readonly sessionId: string;
}): IntegrityRepairOperation {
  const { entryRepo, messageRepo, checkpointRepo, projectId, sessionId } = args;
  return {
    name: `baseline-checkpoint-backfill:session=${sessionId}`,
    kind: "backfill",
    async detect() {
      const files = await listSessionFileHeads(entryRepo, projectId, sessionId);
      if (files.length === 0) {
        return { needsRepair: false };
      }
      const messages = await messageRepo.listBySession(sessionId);
      if (messages.length === 0) {
        return { needsRepair: false };
      }
      let firstGapIndex = 0;
      for (let i = messages.length - 1; i >= 0; i--) {
        const has = await checkpointRepo.hasCheckpoint(
          sessionId,
          messages[i]!.id,
        );
        if (has) {
          firstGapIndex = i + 1;
          break;
        }
      }
      if (firstGapIndex >= messages.length) {
        return { needsRepair: false };
      }
      return {
        needsRepair: true,
        details: `session=${sessionId} 在第 ${firstGapIndex + 1} 条消息处开始有空窗，共 ${messages.length - firstGapIndex} 条缺 baseline checkpoint`,
      };
    },
    async repair() {
      await backfillBaselineCheckpoints(
        entryRepo,
        messageRepo,
        checkpointRepo,
        projectId,
        sessionId,
      );
    },
  };
}
