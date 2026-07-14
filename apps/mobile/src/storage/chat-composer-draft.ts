/**
 * In-memory chat composer drafts keyed by session.
 * Shape: `{ text, attachments }`（与 Desktop 对齐；本期不做落库）。
 */

import type { MessageAttachment } from '@novel-master/core/chat';

export type ChatComposerDraft = {
  readonly text: string;
  readonly attachments: readonly MessageAttachment[];
};

const bySession = new Map<string, ChatComposerDraft>();

const EMPTY: ChatComposerDraft = { text: '', attachments: [] };

export function readChatComposerDraftState(
  sessionId: string | undefined,
): ChatComposerDraft {
  if (sessionId == null || sessionId === '') {
    return EMPTY;
  }
  return bySession.get(sessionId) ?? EMPTY;
}

/** 兼容旧调用：仅读 text。 */
export function readChatComposerDraft(sessionId: string | undefined): string {
  return readChatComposerDraftState(sessionId).text;
}

/**
 * 写入正文；保留已有 attachments（除非两侧皆空则删会话条目）。
 */
export function writeChatComposerDraft(
  sessionId: string | undefined,
  text: string,
): void {
  if (sessionId == null || sessionId === '') {
    return;
  }
  const prev = bySession.get(sessionId);
  const attachments = prev?.attachments ?? [];
  if (!text && attachments.length === 0) {
    bySession.delete(sessionId);
    return;
  }
  bySession.set(sessionId, { text, attachments: [...attachments] });
}

/**
 * 规则差集 / @ 选择器：按 path（或 name）去重合并 attachments。
 * 回调形状与 Desktop `composerAttachmentsSuggest` 一致：`{ sessionId, attachments }`。
 */
export function applyComposerAttachmentsSuggest(payload: {
  readonly sessionId: string;
  readonly attachments: readonly MessageAttachment[];
}): void {
  const { sessionId, attachments } = payload;
  if (sessionId === '' || attachments.length === 0) {
    return;
  }
  const prev = bySession.get(sessionId) ?? EMPTY;
  const merged = mergeAttachmentsByPath(prev.attachments, attachments);
  if (!prev.text && merged.length === 0) {
    bySession.delete(sessionId);
    return;
  }
  bySession.set(sessionId, { text: prev.text, attachments: merged });
}

function mergeAttachmentsByPath(
  existing: readonly MessageAttachment[],
  incoming: readonly MessageAttachment[],
): MessageAttachment[] {
  const out = [...existing];
  const seen = new Set(
    existing.map(a => attachmentDedupeKey(a)).filter((k): k is string => k != null),
  );
  for (const item of incoming) {
    const key = attachmentDedupeKey(item);
    if (key != null && seen.has(key)) {
      continue;
    }
    if (key != null) {
      seen.add(key);
    }
    out.push(item);
  }
  return out;
}

function attachmentDedupeKey(a: MessageAttachment): string | null {
  if (a.path != null && a.path !== '') {
    return `path:${a.path}`;
  }
  if (a.source === 'user_ops') {
    return `user_ops:${a.name}`;
  }
  return null;
}
