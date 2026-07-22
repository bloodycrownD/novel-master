/**
 * 消息正文批注草稿进程内会话 Map（subscribe / CRUD）。
 * 与文件批注 store 硬分离；**禁止**写入 chip 投影
 *（`chipsFromAnnotateStore` / `unionComposerStatusWithAnnotate`）。
 *
 * @module domain/chat/logic/chat-message-annotate-draft-store
 */

import type { MessageAnnotateDraft } from "../model/annotate-draft.schema.js";

const bySession = new Map<string, MessageAnnotateDraft[]>();

type MessageAnnotateListener = (sessionId: string) => void;
const listeners = new Set<MessageAnnotateListener>();

/** 订阅消息批注草稿变更；返回取消订阅。 */
export function subscribeChatMessageAnnotateDraft(
  listener: MessageAnnotateListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyMessageAnnotateListeners(sessionId: string): void {
  for (const listener of listeners) {
    listener(sessionId);
  }
}

function cloneDrafts(
  list: readonly MessageAnnotateDraft[],
): MessageAnnotateDraft[] {
  return list.map((d) => ({ ...d }));
}

/** 读本会话未发送消息批注草稿（快照）。 */
export function listChatMessageAnnotateDrafts(
  sessionId: string | undefined,
): readonly MessageAnnotateDraft[] {
  if (sessionId == null || sessionId === "") {
    return [];
  }
  return cloneDrafts(bySession.get(sessionId) ?? []);
}

/** 本会话是否有未发送消息批注。 */
export function hasChatMessageAnnotateDrafts(
  sessionId: string | undefined,
): boolean {
  if (sessionId == null || sessionId === "") {
    return false;
  }
  return (bySession.get(sessionId)?.length ?? 0) > 0;
}

/** 新增一条消息批注草稿。 */
export function addChatMessageAnnotateDraft(
  sessionId: string,
  draft: MessageAnnotateDraft,
): void {
  if (sessionId === "") {
    return;
  }
  const prev = bySession.get(sessionId) ?? [];
  bySession.set(sessionId, [...prev, { ...draft }]);
  notifyMessageAnnotateListeners(sessionId);
}

/** 更新一条消息批注说明（按 id）。 */
export function updateChatMessageAnnotateDraft(
  sessionId: string,
  id: string,
  patch: Pick<MessageAnnotateDraft, "userAnnotation"> &
    Partial<Pick<MessageAnnotateDraft, "originalText">>,
): void {
  if (sessionId === "") {
    return;
  }
  const prev = bySession.get(sessionId);
  if (prev == null) {
    return;
  }
  let changed = false;
  const next = prev.map((d) => {
    if (d.id !== id) {
      return d;
    }
    changed = true;
    return {
      ...d,
      originalText: patch.originalText ?? d.originalText,
      userAnnotation: patch.userAnnotation,
    };
  });
  if (!changed) {
    return;
  }
  bySession.set(sessionId, next);
  notifyMessageAnnotateListeners(sessionId);
}

/** 删除一条消息批注草稿（删 Composer tag 时同步调用）。 */
export function removeChatMessageAnnotateDraft(
  sessionId: string,
  id: string,
): void {
  if (sessionId === "") {
    return;
  }
  const prev = bySession.get(sessionId);
  if (prev == null) {
    return;
  }
  const next = prev.filter((d) => d.id !== id);
  if (next.length === prev.length) {
    return;
  }
  if (next.length === 0) {
    bySession.delete(sessionId);
  } else {
    bySession.set(sessionId, next);
  }
  notifyMessageAnnotateListeners(sessionId);
}

/** append 成功后清空本会话消息批注。 */
export function clearChatMessageAnnotateDrafts(
  sessionId: string | undefined,
): void {
  if (sessionId == null || sessionId === "") {
    return;
  }
  if (!bySession.has(sessionId)) {
    return;
  }
  bySession.delete(sessionId);
  notifyMessageAnnotateListeners(sessionId);
}

/** 测试用：清空全部会话消息批注。 */
export function resetChatMessageAnnotateDraftStoreForTests(): void {
  bySession.clear();
}
