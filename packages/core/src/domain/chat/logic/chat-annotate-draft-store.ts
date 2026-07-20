/**
 * 批注草稿进程内会话 Map（subscribe / CRUD / chip 投影）。
 * 允许 App 经本 API 读写；禁止写入 `composer_draft_json`。
 *
 * @module domain/chat/logic/chat-annotate-draft-store
 */

import type { AnnotateDraft } from "../model/annotate-draft.schema.js";
import type { MessageAttachment } from "../model/message-attachment.schema.js";

const bySession = new Map<string, AnnotateDraft[]>();

type AnnotateListener = (sessionId: string) => void;
const listeners = new Set<AnnotateListener>();

/** 订阅批注草稿变更；返回取消订阅。 */
export function subscribeChatAnnotateDraft(
  listener: AnnotateListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyAnnotateListeners(sessionId: string): void {
  for (const listener of listeners) {
    listener(sessionId);
  }
}

function cloneDrafts(list: readonly AnnotateDraft[]): AnnotateDraft[] {
  return list.map((d) => ({ ...d }));
}

/** 读本会话未发送批注草稿（快照）。 */
export function listChatAnnotateDrafts(
  sessionId: string | undefined,
): readonly AnnotateDraft[] {
  if (sessionId == null || sessionId === "") {
    return [];
  }
  return cloneDrafts(bySession.get(sessionId) ?? []);
}

/** 本会话是否有未发送批注。 */
export function hasChatAnnotateDrafts(
  sessionId: string | undefined,
): boolean {
  if (sessionId == null || sessionId === "") {
    return false;
  }
  return (bySession.get(sessionId)?.length ?? 0) > 0;
}

/** 按 path 聚合一只 annotate 预览 chip（`source:user_ops` + `action:annotate`）。 */
export function chipsFromAnnotateStore(
  sessionId: string | undefined,
): MessageAttachment[] {
  const drafts = listChatAnnotateDrafts(sessionId);
  const seen = new Set<string>();
  const chips: MessageAttachment[] = [];
  for (const d of drafts) {
    if (seen.has(d.path)) {
      continue;
    }
    seen.add(d.path);
    chips.push({
      name: d.path,
      source: "user_ops",
      type: "text",
      content: null,
      path: d.path,
      action: "annotate",
    });
  }
  return chips;
}

/**
 * 投影结果 ∪ annotate store chips（按 path 一只）。
 * 先去掉既有 annotate 预览，再合并 store，避免重复。
 */
export function unionComposerStatusWithAnnotate(
  projected: readonly MessageAttachment[],
  sessionId: string | undefined,
): MessageAttachment[] {
  const withoutAnnotate = projected.filter((a) => a.action !== "annotate");
  return [...withoutAnnotate, ...chipsFromAnnotateStore(sessionId)];
}

/** 新增一条批注草稿。 */
export function addChatAnnotateDraft(
  sessionId: string,
  draft: AnnotateDraft,
): void {
  if (sessionId === "") {
    return;
  }
  const prev = bySession.get(sessionId) ?? [];
  bySession.set(sessionId, [...prev, { ...draft }]);
  notifyAnnotateListeners(sessionId);
}

/** 更新一条批注说明（按 id）。 */
export function updateChatAnnotateDraft(
  sessionId: string,
  id: string,
  patch: Pick<AnnotateDraft, "userAnnotation"> &
    Partial<Pick<AnnotateDraft, "originalText">>,
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
  notifyAnnotateListeners(sessionId);
}

/** 删除一条批注草稿。 */
export function removeChatAnnotateDraft(
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
  notifyAnnotateListeners(sessionId);
}

/** 删光某 path 下全部批注。 */
export function removeChatAnnotateDraftsByPath(
  sessionId: string,
  path: string,
): void {
  if (sessionId === "") {
    return;
  }
  const prev = bySession.get(sessionId);
  if (prev == null) {
    return;
  }
  const next = prev.filter((d) => d.path !== path);
  if (next.length === prev.length) {
    return;
  }
  if (next.length === 0) {
    bySession.delete(sessionId);
  } else {
    bySession.set(sessionId, next);
  }
  notifyAnnotateListeners(sessionId);
}

/** append 成功后清空本会话批注。 */
export function clearChatAnnotateDrafts(sessionId: string | undefined): void {
  if (sessionId == null || sessionId === "") {
    return;
  }
  if (!bySession.has(sessionId)) {
    return;
  }
  bySession.delete(sessionId);
  notifyAnnotateListeners(sessionId);
}

/** 测试用：清空全部会话批注。 */
export function resetChatAnnotateDraftStoreForTests(): void {
  bySession.clear();
}
