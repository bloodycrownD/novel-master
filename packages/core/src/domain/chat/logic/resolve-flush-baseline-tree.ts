/**
 * 解析 flush 基准：最近 message checkpoint 文件树 + 推导目录集。
 *
 * @module domain/chat/logic/resolve-flush-baseline-tree
 */

import type { MessageRepository } from "../repositories/message.port.js";
import type { MessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/message-checkpoint.port.js";
import {
  deriveDirPathsFromFileTree,
  emptyWorkspaceFlushSnapshot,
  type WorkspaceFlushSnapshot,
} from "./workspace-flush-snapshot.js";

/** 取会话当前最大 seq（flush 前终态对比上界）。 */
async function resolveMaxSeq(
  messages: MessageRepository,
  sessionId: string,
): Promise<number> {
  const list = await messages.listBySession(sessionId);
  if (list.length === 0) {
    return 0;
  }
  return Math.max(...list.map((message) => message.seq));
}

/**
 * 加载 flush 基准快照：最近 checkpoint 文件树 + 由路径推导的父目录集。
 *
 * @param maxSeq - 可选；省略时从 {@link MessageRepository} 读取会话最大 seq。
 */
export async function resolveFlushBaselineTree(
  checkpoints: MessageCheckpointRepository,
  messages: MessageRepository,
  sessionId: string,
  maxSeq?: number,
): Promise<WorkspaceFlushSnapshot> {
  const seq = maxSeq ?? (await resolveMaxSeq(messages, sessionId));
  const messageId = await checkpoints.findCheckpointMessageIdAtOrBefore(
    sessionId,
    seq,
  );
  if (messageId == null) {
    return emptyWorkspaceFlushSnapshot();
  }

  const tree = await checkpoints.loadFileTree(sessionId, messageId);
  const fileTree = tree ?? new Map<string, number>();
  return {
    fileTree,
    dirPaths: deriveDirPathsFromFileTree(fileTree),
  };
}
