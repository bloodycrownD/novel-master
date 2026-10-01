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
import {
  copyVfsTree,
  deleteVfsPrefix,
  sweepRevisionsUnderScope,
} from "@/domain/vfs/logic/vfs-tree-copy.js";
import { seedLiveHeadRevisionsUnderPrefix } from "@/domain/vfs/logic/seed-live-head-revisions.js";
import { chatInvalidArgument, chatNotFound } from "@/errors/chat-errors.js";
import { decode } from "@/infra/serialization/decode.js";
import { SqliteProjectRepository } from "@/domain/chat/repositories/impl/sqlite-project.repository.js";
import { SqliteSessionRepository } from "@/domain/chat/repositories/impl/sqlite-session.repository.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import {
  aggregateReadRefPointers,
  adjustReadRefCount,
} from "@/domain/vfs/logic/revision-ref-count.js";
import {
  deleteSessionFsData,
  runDeferredBlobGc,
} from "@/service/session-fs/create-session-fs-service.js";
import { createSessionKkvService } from "@/service/session-kkv/create-session-kkv-service.js";
import { runDeferredFileCacheGc } from "@/domain/session-kkv/logic/deferred-file-cache-gc.js";
import { createSessionRunStateService } from "@/service/session-run-state/create-session-run-state-service.js";
import { SqliteSkillDisabledRuleRepository } from "@/domain/skills/repositories/impl/sqlite-skill-disabled-rule.repository.js";
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
  patch: ProjectAgentConfigPatch
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
  config: ProjectAgentConfig
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
    const updated = await this.deps.projects.updateName(
      id,
      trimmed,
      updatedAtMs
    );
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
        // read 引用 −1（BFS 展开的每个会话、messages.deleteBySession 之前）：
        // 该路径自有事务、不经过 deleteSessionTree——独立挂点，漏了会让被其它
        // 会话引用的 revision 永久泄漏（无自愈）。
        // 窄投影读口（4 列）替掉 21 列全量读（与 session.service 的
        // deleteSessionTree 同型同修法）；读仍留在事务内——它产出的就是要减的写集合。
        await adjustReadRefCount(
          r.revisions,
          aggregateReadRefPointers(
            (await r.messages.listReadRefTargetsBySession(session.id)).map(
              (t) => t.refs
            )
          ),
          -1
        );
        await r.messages.deleteBySession(session.id);
        await deleteSessionFsData(tx, session.id, id);
        await sessionKkv.clearSession(session.id);
        // entry_id 化后会话独立 scope：session:{pid}:{sid}，前缀为"/"
        // 【勿换成 sweepRevisionsUnderScope】：该 scope 的 live ref 已由上面的
        // deleteSessionFsData 释放（decrementLiveRefsUnderScope），此行时 entry 仍在，
        // 再跑一次 decrement 会对同一批 live head 二次 −1，撞 vfs_revision 的
        // CHECK (ref_count >= 0) 抛 SQLITE_CONSTRAINT_CHECK → 整个 delete 事务回滚。
        await deleteVfsPrefix(r.vfs, `session:${id}:${session.id}`, "/");
      }
      // run_state 表带 project_id 列，一条 DELETE 等价于逐会话清理
      // （BFS 展开的 allSessions 集合 = 该 project 全部会话）；
      // 留着孤儿 starting/running 行会在重启水合时生成幽灵 interrupted 单元。
      await createSessionRunStateService(tx).deleteByProject(id);
      await r.sessions.deleteByProject(id);
      // 项目 scope 只剩 template（会话都有自己的 scope）；技能负清单行一并清理，
      // 避免留下指向已删项目的孤儿禁用行。
      await new SqliteSkillDisabledRuleRepository(tx).removeScope(
        `project:${id}`
      );
      // 项目 scope：copy/模板推送会在此 scope 下种下 ref_count=1 的 live-head
      // revision（seedLiveHeadRevisionsUnderPrefix），裸 deleteVfsPrefix 只删 entry、
      // 既不释放 live ref 也不 GC revision ⇒ 每「种下一次再删项目」就永久泄漏一批
      // revision 行 + 其 blob（两条 GC 路径都选不中，deleteGlobalOrphans 只清
      // ref_count <= 0 的 JOIN 孤儿）。改走 sweep：decrement → GC → 删 entry。
      await sweepRevisionsUnderScope(r.vfs, r.revisions, `project:${id}`, "/");
      // 技能已重定位到独立 meta 域：scope_key 精确匹配，不补这条会留下
      // project:{pid}:meta 的孤儿 entry 行（同样要 sweep，见上一条注释）
      await sweepRevisionsUnderScope(
        r.vfs,
        r.revisions,
        `project:${id}:meta`,
        "/"
      );
      const deleted = await r.projects.delete(id);
      if (!deleted) {
        throw chatNotFound("project", id);
      }
    });
    await runDeferredBlobGc(this.deps.conn);
    // file_cache 引用行随上面的事务删除，缓存 blob 的回收同样在提交后调度
    await runDeferredFileCacheGc(this.deps.conn);
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
    options: ValidateAgentDefinitionOptions = {}
  ): Promise<ProjectAgentConfig> {
    await this.get(id);
    const current = await this.getAgentConfig(id);
    const merged = mergeAgentConfigPatch(current, patch);
    const validated = decode(
      projectAgentConfigSchema.toWire(merged),
      projectAgentConfigSchema
    );
    if (validated.mode === "custom") {
      await validateAgentDefinition(validated.definition!, options);
    }
    const updatedAtMs = Date.now();
    const configJson = serializeAgentConfigForStorage(validated);
    const updated = await this.deps.projects.updateAgentConfig(
      id,
      configJson,
      updatedAtMs
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
        { contentStore }
      );
      await copyVfsTree(
        r.vfs,
        { scopeKey: `project:${id}:meta` },
        "/",
        { scopeKey: `project:${copy.id}:meta` },
        "/",
        { contentStore }
      );
      await new SqliteSkillDisabledRuleRepository(tx).copyScopeRules(
        `project:${id}`,
        `project:${copy.id}`
      );
      await seedLiveHeadRevisionsUnderPrefix(
        r.vfs,
        r.revisions,
        `project:${copy.id}`,
        "/",
        contentStore
      );
      await seedLiveHeadRevisionsUnderPrefix(
        r.vfs,
        r.revisions,
        `project:${copy.id}:meta`,
        "/",
        contentStore
      );
      return copy;
    });
  }
}
