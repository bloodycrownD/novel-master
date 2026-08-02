/**
 * Session application service port.
 *
 * @module service/chat/session.port
 */

import type { ChatSession } from "@/domain/chat/model/session.js";
import type {
  SessionAgentConfig,
  SessionAgentConfigPatch,
} from "@/domain/chat/model/session-agent-config.js";

/** Session CRUD, template copy on create, and full copy. */
export interface SessionService {
  listByProject(projectId: string): Promise<ChatSession[]>;

  get(id: string): Promise<ChatSession>;

  /** Creates session and copies project template VFS into session domain. */
  create(projectId: string, title?: string | null): Promise<ChatSession>;

  rename(id: string, title: string): Promise<ChatSession>;

  delete(id: string): Promise<void>;

  /** Copies session VFS tree and all messages to a new session. */
  copy(id: string): Promise<ChatSession>;

  /**
   * Overwrites session VFS + worktree from project template;
   * clears session-fs data but not messages.
   */
  pullTemplate(sessionId: string): Promise<void>;

  /** 读取 `composer_draft_json` 原始 JSON；未设置时为 null。 */
  getComposerDraftJson(id: string): Promise<string | null>;

  /**
   * 写入 `composer_draft_json`；`draftJson` 为 null 时清空列。
   * 不更新 `updated_at_ms`。
   */
  setComposerDraftJson(
    id: string,
    draftJson: string | null,
  ): Promise<boolean>;

  /**
   * 读取会话智能体配置；列 NULL 时返回 {@link DEFAULT_SESSION_AGENT_CONFIG}
   * （mode=follow）。
   */
  getSessionAgentConfig(id: string): Promise<SessionAgentConfig>;

  /**
   * 应用 patch 到当前配置（partial overlay），校验后写入列。
   *
   * - `{ mode: "follow" }`：解绑，列存 NULL。
   * - `{ mode: "bind"; agentId; modelId? }`：整体替换为 bind。
   * - `{ modelId: string | null }`：仅改 model 覆盖，保持 mode/agentId；
   *   当前为 follow 时会因缺 agentId 被 schema 拒绝。
   */
  updateSessionAgentConfig(
    id: string,
    patch: SessionAgentConfigPatch,
  ): Promise<SessionAgentConfig>;
}
