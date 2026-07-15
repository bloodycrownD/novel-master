/**
 * Chat session repository port.
 *
 * @module domain/chat/repositories/session.port
 */

import type { ChatSession } from "../model/session.js";

/** Persistence for `chat_session` rows. */
export interface SessionRepository {
  listByProject(projectId: string): Promise<ChatSession[]>;

  findById(id: string): Promise<ChatSession | null>;

  insert(session: ChatSession): Promise<void>;

  updateTitle(
    id: string,
    title: string,
    updatedAtMs: number,
  ): Promise<boolean>;

  delete(id: string): Promise<boolean>;

  deleteByProject(projectId: string): Promise<void>;

  /** 读取 `composer_draft_json` 原始 JSON；未设置时为 null。 */
  getComposerDraftJson(id: string): Promise<string | null>;

  /**
   * 写入 `composer_draft_json`；`draftJson` 为 null 时清空列。
   * 不更新 `updated_at_ms`（草稿高频写，不冒充会话列表活动时间）。
   */
  setComposerDraftJson(
    id: string,
    draftJson: string | null,
  ): Promise<boolean>;
}
