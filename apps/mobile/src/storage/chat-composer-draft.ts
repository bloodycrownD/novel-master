/**
 * Chat composer drafts keyed by session。
 * 内存 Map 作 UI 缓存；`composer_draft_json`（仅 attach+text）为权威。
 */

import {
  parseComposerDraftJson,
  replaceComposerStatusAttachments,
  serializeComposerDraftJson,
  type MessageAttachment,
} from '@novel-master/core/chat';
import { unionComposerStatusWithAnnotate } from './chat-annotate-draft';

export type ChatComposerDraft = {
  readonly text: string;
  readonly attachments: readonly MessageAttachment[];
};

const bySession = new Map<string, ChatComposerDraft>();

const EMPTY: ChatComposerDraft = { text: '', attachments: [] };

type DraftListener = (sessionId: string) => void;
const listeners = new Set<DraftListener>();

/** 订阅草稿变更（attachments 合并等）；返回取消订阅。 */
export function subscribeChatComposerDraft(
  listener: DraftListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyDraftListeners(sessionId: string): void {
  for (const listener of listeners) {
    listener(sessionId);
  }
}

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

type ComposerDraftPersistence = {
  getComposerDraftJson(id: string): Promise<string | null>;
  setComposerDraftJson(
    id: string,
    draftJson: string | null,
  ): Promise<boolean>;
};

/** 仅持久 attach+text（状态条不进列）。 */
async function persistAttachTextDraft(
  sessions: ComposerDraftPersistence,
  sessionId: string,
  draft: ChatComposerDraft,
): Promise<void> {
  // draft attach 恒空；仅持久正文（含 `@路径`）
  const json = serializeComposerDraftJson({
    text: draft.text,
    attachments: [],
  });
  await sessions.setComposerDraftJson(sessionId, json);
}

/**
 * 写入正文；保留已有 attachments（除非两侧皆空则删会话条目）。
 * 同步更新缓存；若传入 sessions 则异步落库 attach+text。
 */
export function writeChatComposerDraft(
  sessionId: string | undefined,
  text: string,
  sessions?: ComposerDraftPersistence,
): void {
  if (sessionId == null || sessionId === '') {
    return;
  }
  const prev = bySession.get(sessionId);
  const attachments = prev?.attachments ?? [];
  if (!text && attachments.length === 0) {
    bySession.delete(sessionId);
    if (sessions != null) {
      void sessions.setComposerDraftJson(sessionId, null);
    }
    return;
  }
  const next: ChatComposerDraft = { text, attachments: [...attachments] };
  bySession.set(sessionId, next);
  if (sessions != null) {
    void persistAttachTextDraft(sessions, sessionId, next);
  }
}

/** 写入完整草稿 `{ text, attachments }`（缓存含状态条；落库仅 attach+text）。 */
export function writeChatComposerDraftState(
  sessionId: string | undefined,
  draft: ChatComposerDraft,
  sessions?: ComposerDraftPersistence,
): void {
  if (sessionId == null || sessionId === '') {
    return;
  }
  if (!draft.text && draft.attachments.length === 0) {
    bySession.delete(sessionId);
    if (sessions != null) {
      void sessions.setComposerDraftJson(sessionId, null);
    }
    return;
  }
  const next: ChatComposerDraft = {
    text: draft.text,
    attachments: [...draft.attachments],
  };
  bySession.set(sessionId, next);
  if (sessions != null) {
    void persistAttachTextDraft(sessions, sessionId, next);
  }
}

/** 清空会话草稿（发送成功后）。 */
export function clearChatComposerDraft(
  sessionId: string | undefined,
  sessions?: ComposerDraftPersistence,
): void {
  if (sessionId == null || sessionId === '') {
    return;
  }
  bySession.delete(sessionId);
  if (sessions != null) {
    void sessions.setComposerDraftJson(sessionId, null);
  }
}

/**
 * 从 DB 水化缓存（仅 text+attach）；再与现有状态条合并进 UI 缓存。
 * 调用方随后应 `projectComposerStatusAttachments` 整表替换状态条。
 */
export async function hydrateChatComposerDraftFromDb(
  sessionId: string,
  sessions: ComposerDraftPersistence,
): Promise<ChatComposerDraft> {
  const raw = await sessions.getComposerDraftJson(sessionId);
  const parsed = parseComposerDraftJson(raw);
  const prev = bySession.get(sessionId);
  const statusOnly =
    prev?.attachments.filter(
      a => a.source === 'workplace' || a.source === 'user_ops',
    ) ?? [];
  const next: ChatComposerDraft = {
    text: parsed.text,
    // 历史 draft attach chip 丢弃；文件引用只认正文 `@路径`
    attachments: [...statusOnly],
  };
  if (!next.text && next.attachments.length === 0) {
    bySession.delete(sessionId);
    notifyDraftListeners(sessionId);
    return EMPTY;
  }
  bySession.set(sessionId, next);
  notifyDraftListeners(sessionId);
  return next;
}

/**
 * 投影结果整表替换状态条（workplace|user_ops），再 ∪ annotate store chips。
 * draft attach 恒空，不保留 existing attach；annotate 永不指望 Core replace 保留。
 */
export function applyComposerStatusAttachmentsReplace(payload: {
  readonly sessionId: string;
  readonly attachments: readonly MessageAttachment[];
}): void {
  const { sessionId, attachments: statusProjected } = payload;
  if (sessionId === '') {
    return;
  }
  const prev = bySession.get(sessionId) ?? EMPTY;
  const replaced = replaceComposerStatusAttachments(
    prev.attachments,
    statusProjected,
  );
  const merged = unionComposerStatusWithAnnotate(replaced, sessionId);
  if (!prev.text && merged.length === 0) {
    bySession.delete(sessionId);
    notifyDraftListeners(sessionId);
    return;
  }
  bySession.set(sessionId, { text: prev.text, attachments: merged });
  notifyDraftListeners(sessionId);
}

/**
 * 仅按 annotate store 重合并状态条（CRUD 后调用；不改 projected 半边）。
 */
export function refreshComposerAnnotateChips(sessionId: string): void {
  if (sessionId === '') {
    return;
  }
  const prev = bySession.get(sessionId) ?? EMPTY;
  applyComposerStatusAttachmentsReplace({
    sessionId,
    attachments: prev.attachments.filter(a => a.action !== 'annotate'),
  });
}
