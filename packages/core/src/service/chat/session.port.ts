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

  /**
   * 创建子 agent 会话（SPEC agent-subagent / P0-4）。
   *
   * 与 {@link create} 不同：**仅 insert**（带 `parentSessionId`），完全不碰 VFS——
   * 不调 `initializeSessionWorkspace`、不创建 child scope、不调 `copyVfsTree`、
   * 不复制项目模板，也不写默认 agent 配置。子 agent run 的 VFS 访问由
   * `runChildAgent` 装配期 `toolCtx.vfs = runtime.sessionVfs(projectId, parentSessionId)`
   * 指向父 session scope 实现。
   *
   * 子 session delete 时 `deleteVfsPrefix(session:{pid}:{childId})` 是无害空操作
   * （child scope 根本没建过），不需 special-case。
   */
  createSubSession(
    parentSessionId: string,
    projectId: string,
    title?: string | null,
  ): Promise<ChatSession>;

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
   * 读取会话智能体配置；列 NULL 视为异常（migration 后不应存在 NULL），
   * 抛 `ChatError(INVALID_ARGUMENT)` 提示运行迁移。
   */
  getSessionAgentConfig(id: string): Promise<SessionAgentConfig>;

  /**
   * partial overlay 更新会话智能体配置。
   *
   * 调用方只传要改的字段即可：`agentId` 可选（不传就保留），`modelId` 不传
   * 保持、传非空串覆盖、传 `null` 清除会话级 model 覆盖。service 内部会拿
   * 当前配置当基线 merge，merge 完再走 schema 校验（`agentId` 必填），最后
   * 序列化写库。返回 merge 之后的完整配置。
   */
  updateSessionAgentConfig(
    id: string,
    patch: SessionAgentConfigPatch,
  ): Promise<SessionAgentConfig>;
}
