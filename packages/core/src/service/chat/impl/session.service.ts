/**
 * Default session service.
 *
 * @module service/chat/impl/session.service
 */

import { randomUUID } from "@/infra/random-uuid.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { ChatSession } from "@/domain/chat/model/session.js";
import {
  DEFAULT_SESSION_AGENT_CONFIG,
  type SessionAgentConfig,
  type SessionAgentConfigPatch,
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

/**
 * 按规约合并 session agent config patch（partial overlay，非 full replace）。
 *
 * - `{ mode: "follow" }`：忽略其它字段，整体落为 follow。
 * - `{ mode: "bind"; agentId; modelId? }`：整体替换为 bind；modelId 未传时不带 pin，
 *   不继承旧 patch 的 modelId。
 * - `{ modelId: string | null }`：保持当前 mode/agentId，仅覆盖 model；
 *   若当前是 follow（无 agentId），合并后为 `{ mode: "follow", modelId }`，
 *   会被后续 schema 校验拒绝（follow 不接受 modelId 字段，且无 agentId 无法转 bind）。
 */
function mergeSessionAgentConfigPatch(
  current: SessionAgentConfig,
  patch: SessionAgentConfigPatch,
): SessionAgentConfig {
  if ("mode" in patch) {
    if (patch.mode === "follow") {
      return { mode: "follow" };
    }
    // mode === "bind"：整体替换；modelId 未传时不带 pin，不继承旧值
    if (patch.modelId != null) {
      return { mode: "bind", agentId: patch.agentId, modelId: patch.modelId };
    }
    return { mode: "bind", agentId: patch.agentId };
  }
  // patch 仅含 modelId：保持当前 mode/agentId，覆盖 model
  if (current.mode !== "bind") {
    // follow 无 agentId，无法单独改 model；按 SPEC 视为非法 patch，拒绝。
    throw chatInvalidArgument(
      "无法在 follow 会话上单独覆盖 modelId：请先 bind agent",
    );
  }
  const merged: SessionAgentConfig =
    patch.modelId == null
      ? { mode: "bind", agentId: current.agentId }
      : { mode: "bind", agentId: current.agentId, modelId: patch.modelId };
  return merged;
}

/**
 * follow 序列化为 NULL（复用 project agent config 的 NULL 规约）；
 * 否则存 wire JSON。
 */
function serializeSessionAgentConfigForStorage(
  config: SessionAgentConfig,
): string | null {
  if (config.mode === "follow") {
    return null;
  }
  return JSON.stringify(sessionAgentConfigSchema.toWire(config));
}

/** Dependencies for {@link DefaultSessionService}. */
export interface SessionServiceDeps {
  readonly conn: TdbcConnection;
  readonly projects: ProjectRepository;
  readonly sessions: SessionRepository;
  readonly messages: MessageRepository;
  readonly vfs: VfsEntryRepository;
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
    return this.deps.conn.transaction(async (tx) => {
      const r = reposFor(tx);
      const now = Date.now();
      const session: ChatSession = {
        id: randomUUID(),
        projectId,
        title: title ?? null,
        createdAtMs: now,
        updatedAtMs: now,
      };
      await r.sessions.insert(session);
      await initializeSessionWorkspace(tx, projectId, session.id, {
        clearCheckpoints: false,
      });
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
      const r = reposFor(tx);
      await r.messages.deleteBySession(id);
      await deleteSessionFsData(tx, id, session.projectId);
      await createSessionKkvService(tx).clearSession(id);
      await deleteVfsPrefix(
        r.vfs,
        `session:${session.projectId}:${id}`,
        "/",
      );
      const deleted = await r.sessions.delete(id);
      if (!deleted) {
        throw chatNotFound("session", id);
      }
    });
    await runDeferredBlobGc(this.deps.conn);
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
      return DEFAULT_SESSION_AGENT_CONFIG;
    }
    return parseStoredSessionAgentConfig(json);
  }

  async updateSessionAgentConfig(
    id: string,
    patch: SessionAgentConfigPatch,
  ): Promise<SessionAgentConfig> {
    await this.get(id);
    const current = await this.getSessionAgentConfig(id);
    const merged = mergeSessionAgentConfigPatch(current, patch);
    // decode 既是校验也是规范化（含 strict + superRefine）。
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
   * 复制会话（VFS + 消息）。
   *
   * @remarks **不**复制 `session_kkv_entry`；新会话侧 kkv 为空，首次拼装重建。
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
        createdAtMs: now,
        updatedAtMs: now,
      };
      await r.sessions.insert(copy);
      // 刻意不复制 session_kkv（SPEC：fork/copy 不复制 kkv）
      // 刻意不复制 composer_draft_json / agent_config_json（SPEC：copy 不复制草稿与绑定，
      // 新会话默认 follow）。绑定是用户主动行为，复制后需重新设置。
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
