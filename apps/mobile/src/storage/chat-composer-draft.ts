/**
 * Chat composer drafts keyed by session。
 * 内存 Map 作 UI 缓存；`composer_draft_json`（text+tokenRanges，attach 恒空）为权威。
 */

import {
  parseComposerDraftJson,
  serializeComposerDraftJson,
  unionComposerStatusWithAnnotate,
  type ComposerDraftTokenRange,
  type MessageAttachment,
} from '@novel-master/core/chat';

export type ChatComposerDraft = {
  readonly text: string;
  readonly attachments: readonly MessageAttachment[];
  /**
   * 确认胶囊区间（D1 持久化优先）：`undefined` = 旧草稿 / 带外写入，允许水化
   * 兜底扫描一次；`[]` = 确认无胶囊，禁止扫描。两者语义不同，不可用默认值抹平。
   */
  readonly tokenRanges?: readonly ComposerDraftTokenRange[];
};

/**
 * 组草稿对象：`tokenRanges` 为 undefined 时**不写自有键**（与 core parse 同口径，
 * 避免 `{text, attachments, tokenRanges: undefined}` 这类形状在断言与序列化处
 * 引入噪声）。区间数组拷一份，防止调用方后续可变。
 */
function buildDraft(
  text: string,
  attachments: readonly MessageAttachment[],
  tokenRanges: readonly ComposerDraftTokenRange[] | undefined,
): ChatComposerDraft {
  return tokenRanges !== undefined
    ? {text, attachments: [...attachments], tokenRanges: [...tokenRanges]}
    : {text, attachments: [...attachments]};
}

const bySession = new Map<string, ChatComposerDraft>();

const EMPTY: ChatComposerDraft = {text: '', attachments: []};

type DraftListener = (sessionId: string) => void;
const listeners = new Set<DraftListener>();

/** fire-and-forget 落库失败仅告警，不产生 unhandled rejection。 */
function warnPersistFailure(error: unknown): void {
  console.warn('[chat-composer-draft] persist draft failed:', error);
}

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

type ComposerDraftPersistence = {
  getComposerDraftJson(id: string): Promise<string | null>;
  setComposerDraftJson(id: string, draftJson: string | null): Promise<boolean>;
};

/** 仅持久 text+tokenRanges（状态条不进列；attach 恒空）。 */
async function persistAttachTextDraft(
  sessions: ComposerDraftPersistence,
  sessionId: string,
  draft: ChatComposerDraft,
): Promise<void> {
  // draft attach 恒空；仅持久正文（含 `@路径`）+ 确认胶囊区间。
  const json = serializeComposerDraftJson({
    text: draft.text,
    attachments: [],
    // D1：undefined 原样透传（序列化侧不写字段），不臆造 `[]` 默认值。
    tokenRanges: draft.tokenRanges,
  });
  await sessions.setComposerDraftJson(sessionId, json);
}

/**
 * 写入正文；保留已有 attachments（除非两侧皆空则删会话条目）。
 * 同步更新缓存；若传入 sessions 则异步落库 text+tokenRanges。
 *
 * 第 4 参 `tokenRanges`（D1 带外写入口）：**undefined 原样写 undefined**——
 * 不扫正文、不臆造 `[]`，让下一次水化走兜底扫描一次（旧草稿语义）。
 * 现有三参调用零改动。
 */
export function writeChatComposerDraft(
  sessionId: string | undefined,
  text: string,
  sessions?: ComposerDraftPersistence,
  tokenRanges?: readonly ComposerDraftTokenRange[],
): void {
  if (sessionId == null || sessionId === '') {
    return;
  }
  const prev = bySession.get(sessionId);
  const attachments = prev?.attachments ?? [];
  if (!text && attachments.length === 0) {
    bySession.delete(sessionId);
    if (sessions != null) {
      void sessions
        .setComposerDraftJson(sessionId, null)
        .catch(warnPersistFailure);
    }
    return;
  }
  const next = buildDraft(text, attachments, tokenRanges);
  bySession.set(sessionId, next);
  if (sessions != null) {
    void persistAttachTextDraft(sessions, sessionId, next).catch(
      warnPersistFailure,
    );
  }
}

/** 写入完整草稿 `{ text, attachments, tokenRanges? }`（缓存含状态条；落库仅 text+ranges）。 */
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
      void sessions
        .setComposerDraftJson(sessionId, null)
        .catch(warnPersistFailure);
    }
    return;
  }
  const next = buildDraft(draft.text, draft.attachments, draft.tokenRanges);
  bySession.set(sessionId, next);
  if (sessions != null) {
    void persistAttachTextDraft(sessions, sessionId, next).catch(
      warnPersistFailure,
    );
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
    void sessions
      .setComposerDraftJson(sessionId, null)
      .catch(warnPersistFailure);
  }
}

/**
 * 从 DB 水化缓存（text+tokenRanges）；再与现有状态条合并进 UI 缓存。
 * 调用方随后应 `projectComposerStatusForSession` 整表替换状态条。
 *
 * tokenRanges 缺失/非法（core parse 已降级为 undefined）→ 缓存条目同样不带该键，
 * 由 controller 走「旧草稿兜底扫描一次」。
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
  const next = buildDraft(
    parsed.text,
    // 历史 draft attach chip 丢弃；文件引用只认正文 `@路径`
    statusOnly,
    parsed.tokenRanges,
  );
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
 *
 * **必须保留 `prev.tokenRanges`**（D1 P0-2）：controller 水化链是
 * hydrate → project → apply → syncFromDraft，这里丢字段会让 `[]`（确认无胶囊）
 * 退化为 undefined，手输 `$foo` 每次水化都被兜底扫描升格。
 */
export function applyComposerStatusAttachmentsReplace(payload: {
  readonly sessionId: string;
  readonly attachments: readonly MessageAttachment[];
}): void {
  const {sessionId, attachments: statusProjected} = payload;
  if (sessionId === '') {
    return;
  }
  const prev = bySession.get(sessionId) ?? EMPTY;
  const replaced = [...statusProjected];
  const merged = unionComposerStatusWithAnnotate(replaced, sessionId);
  if (!prev.text && merged.length === 0) {
    bySession.delete(sessionId);
    notifyDraftListeners(sessionId);
    return;
  }
  bySession.set(sessionId, buildDraft(prev.text, merged, prev.tokenRanges));
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
