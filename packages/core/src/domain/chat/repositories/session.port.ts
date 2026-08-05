/**
 * Chat session repository port.
 *
 * @module domain/chat/repositories/session.port
 */

import type { ChatSession } from "../model/session.js";

/** Persistence for `chat_session` rows. */
export interface SessionRepository {
  listByProject(projectId: string): Promise<ChatSession[]>;

  /** 按父 session 查子 session（子 agent 会话）；不含 parent_session_id IS NULL 的主会话。 */
  listByParentSession(parentSessionId: string): Promise<ChatSession[]>;

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

  /**
   * 读取 `agent_config_json` 侧信道列原始 JSON；未设置时为 null。
   *
   * 不进 `ChatSession` 主模型，调用方需自行反序列化为 {@link SessionAgentConfig}。
   */
  getSessionAgentConfig(id: string): Promise<string | null>;

  /**
   * 写入 `agent_config_json` 侧信道列；`json` 为 null 时清空列。
   *
   * 与 `setComposerDraftJson` 不同：绑定切换是会话活动（语义比高频草稿写更重），
   * 因此同步更新 `updated_at_ms`。
   */
  setSessionAgentConfig(
    id: string,
    json: string | null,
    updatedAtMs: number,
  ): Promise<boolean>;
}
