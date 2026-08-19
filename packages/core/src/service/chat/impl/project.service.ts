/**
 * Default project service.
 *
 * @module service/chat/impl/project.service
 */

import { randomUUID } from "@/infra/random-uuid.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { ChatProject } from "@/domain/chat/model/project.js";
import {
  DEFAULT_PROJECT_AGENT_CONFIG,
  type ProjectAgentConfig,
  type ProjectAgentConfigPatch,
} from "@/domain/chat/model/project-agent-config.js";
import { projectAgentConfigSchema } from "@/domain/chat/model/project-agent-config.schema.js";
import { validateAgentDefinition } from "@/domain/agent/logic/validate-agent-definition.js";
import type { ValidateAgentDefinitionOptions } from "@/domain/agent/logic/validate-agent-definition.js";
import type { ProjectRepository } from "@/domain/chat/repositories/project.port.js";
import type { SessionRepository } from "@/domain/chat/repositories/session.port.js";
import type { MessageRepository } from "@/domain/chat/repositories/message.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import { copyVfsTree, deleteVfsPrefix } from "@/domain/vfs/logic/vfs-tree-copy.js";
import { seedLiveHeadRevisionsUnderPrefix } from "@/domain/vfs/logic/seed-live-head-revisions.js";
import { chatInvalidArgument, chatNotFound } from "@/errors/chat-errors.js";
import { decode } from "@/infra/serialization/decode.js";
import { SqliteProjectRepository } from "@/domain/chat/repositories/impl/sqlite-project.repository.js";
import { SqliteSessionRepository } from "@/domain/chat/repositories/impl/sqlite-session.repository.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { deleteSessionFsData, runDeferredBlobGc } from "@/service/session-fs/create-session-fs-service.js";
import { createSessionKkvService } from "@/service/session-kkv/create-session-kkv-service.js";
import { SqliteSkillDisabledRuleRepository } from "@/domain/skills/repositories/impl/sqlite-skill-disabled-rule.repository.js";
import { DefaultTemplatePullService } from "@/service/template/impl/template-pull.service.js";
import type { ProjectService } from "../project.port.js";

function reposFor(conn: TdbcConnection) {
  return {
    projects: new SqliteProjectRepository(conn),
    sessions: new SqliteSessionRepository(conn),
    messages: new SqliteMessageRepository(conn),
    vfs: new SqliteVfsEntryRepository(conn),
    revisions: new SqliteVfsRevisionRepository(conn),
  };
}

function parseStoredAgentConfig(json: string): ProjectAgentConfig {
  return decode(JSON.parse(json), projectAgentConfigSchema);
}

function mergeAgentConfigPatch(
  current: ProjectAgentConfig,
  patch: ProjectAgentConfigPatch,
): ProjectAgentConfig {
  return {
    mode: patch.mode ?? current.mode,
    ...(patch.definition !== undefined
      ? { definition: patch.definition }
      : current.definition !== undefined
        ? { definition: current.definition }
        : {}),
  };
}

/** 纯 follow 且无草稿时存 NULL；否则存 wire JSON。 */
function serializeAgentConfigForStorage(
  config: ProjectAgentConfig,
): string | null {
  if (config.mode === "follow" && config.definition == null) {
    return null;
  }
  return JSON.stringify(projectAgentConfigSchema.toWire(config));
}

/** Deep-clones stored JSON for project copy. */
function deepCloneAgentConfigJson(json: string): string {
  return JSON.stringify(JSON.parse(json));
}

/** Dependencies for {@link DefaultProjectService}. */
export interface ProjectServiceDeps {
  readonly conn: TdbcConnection;
  readonly projects: ProjectRepository;
  readonly sessions: SessionRepository;
  readonly messages: MessageRepository;
  readonly vfs: VfsEntryRepository;
}

/**
 * Project service with VFS template copy on `copy`.
 */
export class DefaultProjectService implements ProjectService {
  constructor(private readonly deps: ProjectServiceDeps) {}

  list(): Promise<ChatProject[]> {
    return this.deps.projects.list();
  }

  async get(id: string): Promise<ChatProject> {
    const project = await this.deps.projects.findById(id);
    if (project == null) {
      throw chatNotFound("project", id);
    }
    return project;
  }

  async create(name: string): Promise<ChatProject> {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw chatInvalidArgument("project name must not be empty");
    }
    const now = Date.now();
    const project: ChatProject = {
      id: randomUUID(),
      name: trimmed,
      createdAtMs: now,
      updatedAtMs: now,
    };
    await this.deps.projects.insert(project);
    return project;
  }

  async rename(id: string, name: string): Promise<ChatProject> {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw chatInvalidArgument("project name must not be empty");
    }
    const existing = await this.get(id);
    const updatedAtMs = Date.now();
    const updated = await this.deps.projects.updateName(id, trimmed, updatedAtMs);
    if (!updated) {
      throw chatNotFound("project", id);
    }
    return { ...existing, name: trimmed, updatedAtMs };
  }

  async delete(id: string): Promise<void> {
    await this.deps.conn.transaction(async (tx) => {
      const r = reposFor(tx);
      const project = await r.projects.findById(id);
      if (project == null) {
        throw chatNotFound("project", id);
      }
      const sessionList = await r.sessions.listByProject(id);
      const sessionKkv = createSessionKkvService(tx);
      // listByProject 现在只返 parent_session_id IS NULL 的顶层主会话，
      // 子 agent 会话需要 BFS 展开，否则会留孤儿 messages/fs/kkv/vfs。
      const allSessions: { id: string }[] = [];
      const queue: { id: string }[] = [...sessionList];
      while (queue.length > 0) {
        const s = queue.shift()!;
        allSessions.push(s);
        const children = await r.sessions.listByParentSession(s.id);
        queue.push(...children);
      }
      for (const session of allSessions) {
        await r.messages.deleteBySession(session.id);
        await deleteSessionFsData(tx, session.id, id);
        await sessionKkv.clearSession(session.id);
        // entry_id 化后会话独立 scope：session:{pid}:{sid}，前缀为"/"
        await deleteVfsPrefix(
          r.vfs,
          `session:${id}:${session.id}`,
          "/",
        );
      }
      await r.sessions.deleteByProject(id);
      // 项目 scope 只剩 template（会话都有自己的 scope）；技能负清单行一并清理，
      // 避免留下指向已删项目的孤儿禁用行。
      await new SqliteSkillDisabledRuleRepository(tx).removeScope(`project:${id}`);
      await deleteVfsPrefix(r.vfs, `project:${id}`, "/");
      // 技能已重定位到独立 meta 域：deleteVfsPrefix 按 scope_key 精确匹配，
      // 不补这条会留下 project:{pid}:meta 的孤儿 entry 行
      await deleteVfsPrefix(r.vfs, `project:${id}:meta`, "/");
      const deleted = await r.projects.delete(id);
      if (!deleted) {
        throw chatNotFound("project", id);
      }
    });
    await runDeferredBlobGc(this.deps.conn);
  }

  async pullTemplate(projectId: string): Promise<void> {
    await this.get(projectId);
    await new DefaultTemplatePullService(this.deps.conn).projectTemplatePull(
      projectId,
    );
  }

  /**
   * @deprecated 项目智能体已下线，保留用于 DB 历史数据读取兼容。
   */
  async getAgentConfig(id: string): Promise<ProjectAgentConfig> {
    await this.get(id);
    const json = await this.deps.projects.getAgentConfig(id);
    if (json == null) {
      return DEFAULT_PROJECT_AGENT_CONFIG;
    }
    return parseStoredAgentConfig(json);
  }

  /**
   * @deprecated 项目智能体已下线，保留用于 DB 历史数据读取兼容。
   */
  async updateAgentConfig(
    id: string,
    patch: ProjectAgentConfigPatch,
    options: ValidateAgentDefinitionOptions = {},
  ): Promise<ProjectAgentConfig> {
    await this.get(id);
    const current = await this.getAgentConfig(id);
    const merged = mergeAgentConfigPatch(current, patch);
    const validated = decode(
      projectAgentConfigSchema.toWire(merged),
      projectAgentConfigSchema,
    );
    if (validated.mode === "custom") {
      await validateAgentDefinition(validated.definition!, options);
    }
    const updatedAtMs = Date.now();
    const configJson = serializeAgentConfigForStorage(validated);
    const updated = await this.deps.projects.updateAgentConfig(
      id,
      configJson,
      updatedAtMs,
    );
    if (!updated) {
      throw chatNotFound("project", id);
    }
    return validated;
  }

  async copy(id: string): Promise<ChatProject> {
    const source = await this.get(id);
    const sourceAgentConfigJson = await this.deps.projects.getAgentConfig(id);
    return this.deps.conn.transaction(async (tx) => {
      const r = reposFor(tx);
      const now = Date.now();
      const copy: ChatProject = {
        id: randomUUID(),
        name: `${source.name} (copy)`,
        createdAtMs: now,
        updatedAtMs: now,
      };
      await r.projects.insert(copy);
      if (sourceAgentConfigJson != null) {
        const clonedJson = deepCloneAgentConfigJson(sourceAgentConfigJson);
        await r.projects.updateAgentConfig(copy.id, clonedJson, now);
      }
      // entry_id 化后项目模板独立 scope：project:{id}，逻辑前缀为 "/"
      // 技能已重定位到独立 meta 域（project:{id}:meta），复制时单独整树拷贝
      // （D1：项目复制携带技能文件）；负清单行不往 VFS，需按 scope_key 显式复制。
      const contentStore = new SqliteVfsContentStore(tx);
      await copyVfsTree(
        r.vfs,
        { scopeKey: `project:${id}` },
        "/",
        { scopeKey: `project:${copy.id}` },
        "/",
        { contentStore },
      );
      await copyVfsTree(
        r.vfs,
        { scopeKey: `project:${id}:meta` },
        "/",
        { scopeKey: `project:${copy.id}:meta` },
        "/",
        { contentStore },
      );
      await new SqliteSkillDisabledRuleRepository(tx).copyScopeRules(
        `project:${id}`,
        `project:${copy.id}`,
      );
      await seedLiveHeadRevisionsUnderPrefix(
        r.vfs,
        r.revisions,
        `project:${copy.id}`,
        "/",
        contentStore,
      );
      await seedLiveHeadRevisionsUnderPrefix(
        r.vfs,
        r.revisions,
        `project:${copy.id}:meta`,
        "/",
        contentStore,
      );
      return copy;
    });
  }
}
