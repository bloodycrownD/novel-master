/**
 * 手改操作日志进程内会话 Map（append / list / clear / subscribe + chip 投影）。
 * 不进 `composer_draft_json`；同 PR 停写 `user_vfs_pending` kkv。
 * Desktop 须以 main 进程为本 store 真源（与 userVfsTurn / flush 同进程）。
 *
 * @module domain/chat/logic/chat-user-ops-log-store
 */

import type { MessageAttachment } from "../model/message-attachment.schema.js";
import type { UserOpsLogEntry } from "../model/user-ops-log.schema.js";
import { aggregateUserOpsLogChips } from "./aggregate-user-ops-log-chips.js";

const bySession = new Map<string, UserOpsLogEntry[]>();

type UserOpsLogListener = (sessionId: string) => void;
const listeners = new Set<UserOpsLogListener>();

/** 订阅手改日志变更；返回取消订阅。 */
export function subscribeUserOpsLog(
  listener: UserOpsLogListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyUserOpsLogListeners(sessionId: string): void {
  for (const listener of listeners) {
    listener(sessionId);
  }
}

function cloneEntries(
  list: readonly UserOpsLogEntry[],
): UserOpsLogEntry[] {
  return list.map((e) => ({ ...e }));
}

/** 读本会话未发送手改日志（快照）。 */
export function listUserOpsLog(
  sessionId: string | undefined,
): readonly UserOpsLogEntry[] {
  if (sessionId == null || sessionId === "") {
    return [];
  }
  return cloneEntries(bySession.get(sessionId) ?? []);
}

/** 本会话是否有未发送手改日志。 */
export function hasUnsentUserOpsLog(
  sessionId: string | undefined,
): boolean {
  if (sessionId == null || sessionId === "") {
    return false;
  }
  return (bySession.get(sessionId)?.length ?? 0) > 0;
}

/**
 * 按 path 聚合一只 user_ops 预览 chip（`content: null`）。
 * **不**导出 App 侧 ∪ ops-log；App 仅 `unionComposerStatusWithAnnotate`。
 */
export function chipsFromUserOpsLogStore(
  sessionId: string | undefined,
): MessageAttachment[] {
  return aggregateUserOpsLogChips(listUserOpsLog(sessionId));
}

/** 成功落盘后追加一条操作日志。 */
export function appendUserOpsLog(
  sessionId: string,
  entry: UserOpsLogEntry,
): void {
  if (sessionId === "") {
    return;
  }
  const prev = bySession.get(sessionId) ?? [];
  bySession.set(sessionId, [...prev, { ...entry }]);
  notifyUserOpsLogListeners(sessionId);
}

/**
 * 用整表条目替换本会话日志（Undo `undo_send` 映回）。
 * 空数组等价于 clear。
 */
export function replaceUserOpsLog(
  sessionId: string,
  entries: readonly UserOpsLogEntry[],
): void {
  if (sessionId === "") {
    return;
  }
  if (entries.length === 0) {
    if (!bySession.has(sessionId)) {
      return;
    }
    bySession.delete(sessionId);
    notifyUserOpsLogListeners(sessionId);
    return;
  }
  bySession.set(sessionId, cloneEntries(entries));
  notifyUserOpsLogListeners(sessionId);
}

/** 发送成功 / 手动重置后清空本会话手改日志。 */
export function clearUserOpsLog(sessionId: string | undefined): void {
  if (sessionId == null || sessionId === "") {
    return;
  }
  if (!bySession.has(sessionId)) {
    return;
  }
  bySession.delete(sessionId);
  notifyUserOpsLogListeners(sessionId);
}

/** 测试用：清空全部会话手改日志。 */
export function resetUserOpsLogStoreForTests(): void {
  bySession.clear();
}
