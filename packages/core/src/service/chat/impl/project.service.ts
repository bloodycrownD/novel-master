/**
 * Default project service.
 *
 * @module service/chat/impl/project.service
 */

import { Random } from "@/common/random.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { ChatProject } from "@/domain/chat/model/project.js";
import { DEFAULT_PROJECT_AGENT_CONFIG, type ProjectAgentConfig, type ProjectAgentConfigPatch } from "@/domain/chat/model/project-agent-config.js";
import { projectAgentConfigSchema } from "@/domain/chat/model/project-agent-config.schema.js";
import { validateAgentDefinition } from "@/domain/agent/logic/validate-agent-definition.js";
import type { ValidateAgentDefinitionOptions } from "@/domain/agent/logic/validate-agent-definition.js";
import type { ProjectRepository } from "@/domain/chat/repositories/project.port.js";
import type { SessionRepository } from "@/domain/chat/repositories/session.port.js";
import type { MessageRepository } from "@/domain/chat/repositories/message.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import { copyVfsTree, deleteVfsPrefix, sweepRevisionsUnderScope } from "@/domain/vfs/logic/vfs-tree-copy.js";
import { seedLiveHeadRevisionsUnderPrefix } from "@/domain/vfs/logic/seed-live-head-revisions.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { decode } from "@/infra/serialization/decode.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { deleteSessionFsData, runDeferredBlobGc } from "@/service/session-fs/create-session-fs-service.js";
import { createSessionKkvService } from "@/service/session-kkv/create-session-kkv-service.js";
import { runDeferredFileCacheGc } from "@/domain/session-kkv/logic/deferred-file-cache-gc.js";
import { createSessionRunStateService } from "@/service/session-run-state/create-session-run-state-service.js";
import { SqliteSkillDisabledRuleRepository } from "@/domain/skills/repositories/impl/sqlite-skill-disabled-rule.repository.js";
import { createChatRepoDeps } from "../chat-repo-wiring.js";
import type { ProjectService } from "../project.port.js";

/** Dependencies for {@link DefaultProjectService}. */
interface ProjectServiceDeps {
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

  async get(id: string): Promise<Result<ChatProject, AppError>> {
    const project = await this.deps.projects.findById(id);
    if (project == null) {
      return Result.err(new AppError("CHAT_NOT_FOUND", { detail: `project not found: ${id}`, kind: "project", id }));
    }
    return Result.ok(project);
  }

  async create(name: string): Promise<Result<ChatProject, AppError>> {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return Result.err(new AppError("CHAT_INVALID_ARGUMENT", { detail: "project name must not be empty" }));
    }
    const now = Date.now();
    const project: ChatProject = {
      id: Random.uuid(),
      name: trimmed,
      createdAtMs: now,
      updatedAtMs: now,
    };
    await this.deps.projects.insert(project);
    return Result.ok(project);
  }

  async rename(id: string, name: string): Promise<Result<ChatProject, AppError>> {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return Result.err(new AppError("CHAT_INVALID_ARGUMENT", { detail: "project name must not be empty" }));
    }
    const existing = await this.get(id);
    if (!existing.ok) return existing;
    const updatedAtMs = Date.now();
    const updated = await this.deps.projects.updateName(id, trimmed, updatedAtMs);
    if (!updated) {
      return Result.err(new AppError("CHAT_NOT_FOUND", { detail: `project not found: ${id}`, kind: "project", id }));
    }
    return Result.ok({ ...existing.value, name: trimmed, updatedAtMs });
  }

  async delete(id: string): Promise<Result<void, AppError>> {
    await this.deps.conn.transaction(async (tx) => {
      const r = {...createChatRepoDeps(tx), revisions: new SqliteVfsRevisionRepository(tx)};
      const project = await r.projects.findById(id);
      if (project == null) {
        throw new AppError("CHAT_NOT_FOUND", { detail: `project not found: ${id}`, kind: "project", id });
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
        await deleteSessionFsData(tx, id, session.id);
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
      await new SqliteSkillDisabledRuleRepository(tx).removeScope(`project:${id}`);
      // 项目 scope：copy/模板推送会在此 scope 下种下 ref_count=1 的 live-head
      // revision（seedLiveHeadRevisionsUnderPrefix），裸 deleteVfsPrefix 只删 entry、
      // 既不释放 live ref 也不 GC revision ⇒ 每「种下一次再删项目」就永久泄漏一批
      // revision 行 + 其 blob（两条 GC 路径都选不中，deleteGlobalOrphans 只清
      // ref_count <= 0 的 JOIN 孤儿）。改走 sweep：decrement → GC → 删 entry。
      await sweepRevisionsUnderScope(r.vfs, r.revisions, `project:${id}`, "/");
      // 技能已重定位到独立 meta 域：scope_key 精确匹配，不补这条会留下
      // project:{pid}:meta 的孤儿 entry 行（同样要 sweep，见上一条注释）
      await sweepRevisionsUnderScope(r.vfs, r.revisions, `project:${id}:meta`, "/");
      const deleted = await r.projects.delete(id);
      if (!deleted) {
        throw new AppError("CHAT_NOT_FOUND", { detail: `project not found: ${id}`, kind: "project", id });
      }
    });
    await runDeferredBlobGc(this.deps.conn);
    // file_cache 引用行随上面的事务删除，缓存 blob 的回收同样在提交后调度
    await runDeferredFileCacheGc(this.deps.conn);
    return Result.ok(undefined);
  }

  /**
   * @deprecated 项目智能体已下线，保留用于 DB 历史数据读取兼容。
   */
  async getAgentConfig(id: string): Promise<Result<ProjectAgentConfig, AppError>> {
    const r = await this.get(id);
    if (!r.ok) return Result.err(r.error);
    const json = await this.deps.projects.getAgentConfig(id);
    if (json == null) {
      return Result.ok(DEFAULT_PROJECT_AGENT_CONFIG);
    }
    return decode(JSON.parse(json), projectAgentConfigSchema);
  }

  /**
   * @deprecated 项目智能体已下线，保留用于 DB 历史数据读取兼容。
   */
  async updateAgentConfig(id: string, patch: ProjectAgentConfigPatch, options: ValidateAgentDefinitionOptions = {}): Promise<Result<ProjectAgentConfig, AppError>> {
    const r = await this.get(id);
    if (!r.ok) return Result.err(r.error);
    const current = await this.getAgentConfig(id);
    if (!current.ok) return current;
    const merged: ProjectAgentConfig = {
      mode: patch.mode ?? current.value.mode,
      ...(patch.definition !== undefined ? { definition: patch.definition } : current.value.definition !== undefined ? { definition: current.value.definition } : {}),
    };
    const wire = projectAgentConfigSchema.toWire(merged);
    if (!wire.ok) return Result.err(wire.error);
    const validated = decode(wire.value, projectAgentConfigSchema);
    if (!validated.ok) return validated;
    const config = validated.value;
    if (config.mode === "custom") {
      const validation = await validateAgentDefinition(config.definition!, options);
      if (!validation.ok) return Result.err(validation.error);
    }
    const updatedAtMs = Date.now();
    // 纯 follow 且无草稿时存 NULL；否则存 wire JSON。toWire 门禁失败沿 Result.err 上递（五期门⑦）。
    let configJson: string | null = null;
    if (config.mode !== "follow" || config.definition != null) {
      const configWire = projectAgentConfigSchema.toWire(config);
      if (!configWire.ok) return Result.err(configWire.error);
      configJson = JSON.stringify(configWire.value);
    }
    const updated = await this.deps.projects.updateAgentConfig(id, configJson, updatedAtMs);
    if (!updated) {
      return Result.err(new AppError("CHAT_NOT_FOUND", { detail: `project not found: ${id}`, kind: "project", id }));
    }
    return Result.ok(config);
  }

  async copy(id: string): Promise<Result<ChatProject, AppError>> {
    const source = await this.get(id);
    if (!source.ok) return source;
    const src = source.value;
    const sourceAgentConfigJson = await this.deps.projects.getAgentConfig(id);
    const copyTransaction = this.deps.conn.transaction(async (tx) => {
      const r = {...createChatRepoDeps(tx), revisions: new SqliteVfsRevisionRepository(tx)};
      const now = Date.now();
      const copy: ChatProject = {
        id: Random.uuid(),
        name: `${src.name} (copy)`,
        createdAtMs: now,
        updatedAtMs: now,
      };
      await r.projects.insert(copy);
      if (sourceAgentConfigJson != null) {
        const clonedJson = JSON.stringify(JSON.parse(sourceAgentConfigJson));
        await r.projects.updateAgentConfig(copy.id, clonedJson, now);
      }
      // entry_id 化后项目模板独立 scope：project:{id}，逻辑前缀为 "/"
      // 技能已重定位到独立 meta 域（project:{id}:meta），复制时单独整树拷贝
      // （D1：项目复制携带技能文件）；负清单行不往 VFS，需按 scope_key 显式复制。
      const contentStore = new SqliteVfsContentStore(tx);
      await copyVfsTree(r.vfs, { scopeKey: `project:${id}` }, "/", { scopeKey: `project:${copy.id}` }, "/", { contentStore });
      await copyVfsTree(r.vfs, { scopeKey: `project:${id}:meta` }, "/", { scopeKey: `project:${copy.id}:meta` }, "/", { contentStore });
      await new SqliteSkillDisabledRuleRepository(tx).copyScopeRules(`project:${id}`, `project:${copy.id}`);
      await seedLiveHeadRevisionsUnderPrefix(r.vfs, r.revisions, `project:${copy.id}`, "/", contentStore);
      await seedLiveHeadRevisionsUnderPrefix(r.vfs, r.revisions, `project:${copy.id}:meta`, "/", contentStore);
      return copy;
    });
    return Result.ok(await copyTransaction);
  }
}
