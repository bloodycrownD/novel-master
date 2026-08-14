/**
 * Default session service.
 *
 * @module service/chat/impl/session.service
 */

import { randomUUID } from "@/infra/random-uuid.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { ChatSession } from "@/domain/chat/model/session.js";
import type {
  SessionAgentConfig,
  SessionAgentConfigPatch,
} from "@/domain/chat/model/session-agent-config.js";
import { sessionAgentConfigSchema } from "@/domain/chat/model/session-agent-config.schema.js";
import type { ProjectRepository } from "@/domain/chat/repositories/project.port.js";
import type { SessionRepository } from "@/domain/chat/repositories/session.port.js";
import type { MessageRepository } from "@/domain/chat/repositories/message.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { seedForkCopyParity } from "@/domain/chat/logic/seed-fork-copy-parity.js";
import { copyVfsTree, deleteVfsPrefix } from "@/domain/vfs/logic/vfs-tree-copy.js";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import { DefaultTemplatePullService } from "@/service/template/impl/template-pull.service.js";
import { chatInvalidArgument, chatNotFound } from "@/errors/chat-errors.js";
import { decode } from "@/infra/serialization/decode.js";
import { SqliteProjectRepository } from "@/domain/chat/repositories/impl/sqlite-project.repository.js";
import { SqliteSessionRepository } from "@/domain/chat/repositories/impl/sqlite-session.repository.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { deleteSessionFsData, runDeferredBlobGc } from "@/service/session-fs/create-session-fs-service.js";
import { createSessionKkvService } from "@/service/session-kkv/create-session-kkv-service.js";
import { initializeSessionWorkspace } from "@/service/template/logic/initialize-session-workspace.js";
import { initializeEmptySessionWorkspace } from "@/service/template/logic/initialize-empty-session-workspace.js";
import { resolveWorkspaceAgentForNewSession } from "@/service/agent/logic/agent-run-shared.js";
import type { SessionService } from "../session.port.js";

function reposFor(conn: TdbcConnection) {
  return {
    projects: new SqliteProjectRepository(conn),
    sessions: new SqliteSessionRepository(conn),
    messages: new SqliteMessageRepository(conn),
    vfs: new SqliteVfsEntryRepository(conn),
  };
}

function parseStoredSessionAgentConfig(json: string): SessionAgentConfig {
  return decode(JSON.parse(json), sessionAgentConfigSchema);
}

/** 永远写非 null wire JSON（agentId 必填，schema 校验已保证非空）。 */
function serializeSessionAgentConfigForStorage(
  config: SessionAgentConfig,
): string {
  return JSON.stringify(sessionAgentConfigSchema.toWire(config));
}

/** Dependencies for {@link DefaultSessionService}. */
export interface SessionServiceDeps {
  readonly conn: TdbcConnection;
  readonly projects: ProjectRepository;
  readonly sessions: SessionRepository;
  readonly messages: MessageRepository;
  readonly vfs: VfsEntryRepository;
  /** 用于新建会话时读 workspace 当前 agentId + modelId。 */
  readonly state: {
    getCurrentAgentId(): Promise<string | null | undefined>;
    getCurrentModelId(): Promise<string | null | undefined>;
  };
  /** agentId 缺失时回落 registry 第一个 agent。 */
  readonly agentRegistry: {
    listAgentIds(): Promise<readonly string[]>;
  };
}

/**
 * Session service; `create` copies project template into session VFS.
 */
export class DefaultSessionService implements SessionService {
  constructor(private readonly deps: SessionServiceDeps) {}

  async listByProject(projectId: string): Promise<ChatSession[]> {
    await this.requireProject(projectId);
    return this.deps.sessions.listByProject(projectId);
  }

  async get(id: string): Promise<ChatSession> {
    const session = await this.deps.sessions.findById(id);
    if (session == null) {
      throw chatNotFound("session", id);
    }
    return session;
  }

  async create(
    projectId: string,
    title?: string | null,
  ): Promise<ChatSession> {
    await this.requireProject(projectId);
    // 复制 workspace 当前 agentId + modelId 落到新会话；agentId 缺失回落 registry 首项。
    // 读取放在事务外：state / agentRegistry 走的是另一套表，不需要在 chat_session 事务内同步。
    const agentId = await resolveWorkspaceAgentForNewSession({
      state: this.deps.state,
      agentRegistry: this.deps.agentRegistry,
    });
    if (agentId == null || agentId === "") {
      throw chatInvalidArgument(
        "新建会话失败：workspace 未配置 Agent，且 registry 为空",
      );
    }
    const workspaceModelId = await this.deps.state.getCurrentModelId();
    const config: SessionAgentConfig =
      workspaceModelId == null || workspaceModelId === ""
        ? { agentId }
        : { agentId, modelId: workspaceModelId };
    const configJson = serializeSessionAgentConfigForStorage(config);
    return this.deps.conn.transaction(async (tx) => {
      const r = reposFor(tx);
      const now = Date.now();
      const session: ChatSession = {
        id: randomUUID(),
        projectId,
        title: title ?? null,
        parentSessionId: null,
        createdAtMs: now,
        updatedAtMs: now,
      };
      await r.sessions.insert(session);
      await initializeSessionWorkspace(tx, projectId, session.id, {
        clearCheckpoints: false,
      });
      await r.sessions.setSessionAgentConfig(session.id, configJson, now);
      return session;
    });
  }

  async createSubSession(
    parentSessionId: string,
    projectId: string,
    title?: string | null,
  ): Promise<ChatSession> {
    // Feature A（子会话工作区隔离）：子 session 用自己的 sessionId 从空产生常驻
    // 工作区内容，不再复用父会话工作区缓存。createSubSession 在 insert session 记录
    // 后，为子 session 初始化空工作区（不拷贝项目模板、不拷贝父快照）。
    //
    // 父 session 校验在事务外读（对齐主 session create 的风格：校验在事务外，
    // insert + 初始化在事务内）；事务内用 reposFor(tx) 的 repo。
    const parent = await this.deps.sessions.findById(parentSessionId);
    if (parent == null) {
      throw chatNotFound("session", parentSessionId);
    }
    if (parent.projectId !== projectId) {
      throw chatInvalidArgument(
        `createSubSession: parent projectId ${parent.projectId} !== ${projectId}`,
      );
    }
    return this.deps.conn.transaction(async (tx) => {
      const r = reposFor(tx);
      const now = Date.now();
      const session: ChatSession = {
        id: randomUUID(),
        projectId,
        title: title ?? null,
        parentSessionId,
        createdAtMs: now,
        updatedAtMs: now,
      };
      await r.sessions.insert(session);
      // 为子 session 初始化空工作区（不拷贝项目模板/父快照，只保证 scope 起点为空）。
      await initializeEmptySessionWorkspace(tx, projectId, session.id);
      return session;
    });
  }

  async rename(id: string, title: string): Promise<ChatSession> {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      throw chatInvalidArgument("session title must not be empty");
    }
    const existing = await this.get(id);
    const updatedAtMs = Date.now();
    const updated = await this.deps.sessions.updateTitle(
      id,
      trimmed,
      updatedAtMs,
    );
    if (!updated) {
      throw chatNotFound("session", id);
    }
    return { ...existing, title: trimmed, updatedAtMs };
  }

  async delete(id: string): Promise<void> {
    const session = await this.get(id);
    await this.deps.conn.transaction(async (tx) => {
      await this.deleteSessionTree(tx, session);
    });
    await runDeferredBlobGc(this.deps.conn);
  }

  /**
   * 递归删除 session 及其全部子 session（messages/fs/kkv/vfs 全清）。
   *
   * 必须在事务内调：先 `listByParentSession` 取直接子，递归调本函数删子，
   * 再删自己。子 session delete 时 `deleteVfsPrefix(session:{pid}:{childId})`
   * 是无害空操作（子 session 根本没建过 VFS scope），不需 special-case 跳过。
   */
  private async deleteSessionTree(
    tx: TdbcConnection,
    session: ChatSession,
  ): Promise<void> {
    const r = reposFor(tx);
    // 先递归删全部子 session（深度优先，避免删自己后子变孤儿）。
    const children = await r.sessions.listByParentSession(session.id);
    for (const child of children) {
      await this.deleteSessionTree(tx, child);
    }
    await r.messages.deleteBySession(session.id);
    await deleteSessionFsData(tx, session.id, session.projectId);
    await createSessionKkvService(tx).clearSession(session.id);
    await deleteVfsPrefix(
      r.vfs,
      `session:${session.projectId}:${session.id}`,
      "/",
    );
    const deleted = await r.sessions.delete(session.id);
    if (!deleted) {
      throw chatNotFound("session", session.id);
    }
  }

  async pullTemplate(sessionId: string): Promise<void> {
    await this.get(sessionId);
    await new DefaultTemplatePullService(this.deps.conn).sessionTemplatePull(
      sessionId,
    );
  }

  async getComposerDraftJson(id: string): Promise<string | null> {
    await this.get(id);
    return this.deps.sessions.getComposerDraftJson(id);
  }

  async setComposerDraftJson(
    id: string,
    draftJson: string | null,
  ): Promise<boolean> {
    await this.get(id);
    return this.deps.sessions.setComposerDraftJson(id, draftJson);
  }

  async getSessionAgentConfig(id: string): Promise<SessionAgentConfig> {
    await this.get(id);
    const json = await this.deps.sessions.getSessionAgentConfig(id);
    if (json == null) {
      // migration 后不应有 NULL；这里视为异常，提示运行 session-agent-config-v2。
      throw chatInvalidArgument(
        "session agent config missing, run migration session-agent-config-v2",
      );
    }
    return parseStoredSessionAgentConfig(json);
  }

  async updateSessionAgentConfig(
    id: string,
    patch: SessionAgentConfigPatch,
  ): Promise<SessionAgentConfig> {
    await this.get(id);
    // partial overlay merge：拿当前配置当基线，patch 里只覆盖出现的字段。
    const baseline = await this.getSessionAgentConfig(id);
    // agentId：不传或空串都当作「保持」，传非空串才覆盖。
    const agentId =
      patch.agentId != null && patch.agentId !== ""
        ? patch.agentId
        : baseline.agentId;
    // modelId：undefined 保持当前；null 清除；非空串覆盖。
    let modelId: string | undefined;
    if (patch.modelId === undefined) {
      modelId = baseline.modelId;
    } else if (patch.modelId === null) {
      modelId = undefined;
    } else {
      modelId = patch.modelId;
    }
    const merged: SessionAgentConfig =
      modelId == null ? { agentId } : { agentId, modelId };
    // merge 完走 schema 校验（agentId 必填）+ 规范化（含 strict）。
    const validated = decode(
      sessionAgentConfigSchema.toWire(merged),
      sessionAgentConfigSchema,
    );
    const updatedAtMs = Date.now();
    const configJson = serializeSessionAgentConfigForStorage(validated);
    const updated = await this.deps.sessions.setSessionAgentConfig(
      id,
      configJson,
      updatedAtMs,
    );
    if (!updated) {
      throw chatNotFound("session", id);
    }
    return validated;
  }

  /**
   * 复制会话（VFS + 消息 + agent 配置）。
   *
   * @remarks **不**复制 `session_kkv_entry`；新会话侧 kkv 为空，首次拼装重建。
   * agent_config_json 直接复制源会话原始 JSON（不再默认 follow）。
   * composer_draft_json 维持现状不复制。
   */
  async copy(id: string): Promise<ChatSession> {
    const source = await this.get(id);
    return this.deps.conn.transaction(async (tx) => {
      const r = reposFor(tx);
      const now = Date.now();
      const copy: ChatSession = {
        id: randomUUID(),
        projectId: source.projectId,
        title: source.title == null ? null : `${source.title} (copy)`,
        // P2-13：fork/copy 出的是独立主会话，不继承源会话的 parent 关系。
        parentSessionId: null,
        createdAtMs: now,
        updatedAtMs: now,
      };
      await r.sessions.insert(copy);
      // 刻意不复制 session_kkv（SPEC：fork/copy 不复制 kkv）
      // 刻意不复制 composer_draft_json（维持现状）
      // agent_config_json：继承源会话配置（v2 后 agentId 必填，源不会是 NULL）
      const sourceAgentConfigJson =
        await r.sessions.getSessionAgentConfig(source.id);
      if (sourceAgentConfigJson != null) {
        await r.sessions.setSessionAgentConfig(copy.id, sourceAgentConfigJson, now);
      }
      // 顺序钉死：VFS → MSG(ids) → helper(REV + RULE + CK)
      // entry_id 化后会话独立 scope：session:{pid}:{sid}，逻辑前缀为 "/"
      await copyVfsTree(
        r.vfs,
        { scopeKey: `session:${source.projectId}:${source.id}` },
        "/",
        { scopeKey: `session:${source.projectId}:${copy.id}` },
        "/",
        { contentStore: new SqliteVfsContentStore(tx) },
      );
      const messages = await r.messages.listBySession(source.id);
      const newMessages: { id: string }[] = [];
      for (const msg of messages) {
        const id = randomUUID();
        await r.messages.insert({
          ...msg,
          id,
          sessionId: copy.id,
        });
        newMessages.push({ id });
      }
      await seedForkCopyParity(tx, {
        projectId: source.projectId,
        sourceSessionId: source.id,
        targetSessionId: copy.id,
        newMessages,
      });
      return copy;
    });
  }

  private async requireProject(projectId: string): Promise<void> {
    const project = await this.deps.projects.findById(projectId);
    if (project == null) {
      throw chatNotFound("project", projectId);
    }
  }
}
