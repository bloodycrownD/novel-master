/**
 * 只读物理树服务实现。
 *
 * 存储层零改动：`vfs_entry` 仍按 (scope_key, 逻辑 path) 存行；本服务在应用层
 * 把各域行拼成统一物理视图——global 拼 `/template`、global-meta 拼 `/meta`、
 * project 拼 `/projects/{pid}/template`、project-meta 拼 `/projects/{pid}/meta`、
 * session 拼 `/projects/{pid}/sessions/{sid}`。列目录按目标 scope 逐个
 * {@link SqliteVfsEntryRepository.listEntriesUnderPrefix}（走
 * `idx_vfs_entry_scope_path` 索引），懒加载、不全表扫；`/projects` 层级从
 * `chat_project` / `chat_session` 枚举合成虚拟目录。
 *
 * @module service/vfs/impl/physical-vfs.service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import {
  resolveLogicalPath,
  scopeKey,
  scopePhysicalPrefix,
  type VfsScope,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteProjectRepository } from "@/domain/chat/repositories/impl/sqlite-project.repository.js";
import { SqliteSessionRepository } from "@/domain/chat/repositories/impl/sqlite-session.repository.js";
import type { VfsListEntry } from "@/domain/vfs/model/vfs-list-entry.js";
import type { VfsReadResult } from "@/domain/vfs/ports/vfs-service.port.js";
import { vfsNotFound } from "@/errors/vfs-errors.js";
import { createScopedVfsService } from "../create-scoped-vfs-service.js";
import type { PhysicalVfsService } from "../physical-vfs.port.js";

/** 解析结果：物理路径落到的 scope 与域内逻辑路径。 */
interface ResolvedPhysical {
  readonly scope: VfsScope;
  readonly logicalPath: string;
}

/**
 * 物理路径五前缀解析（顺序敏感：session → project-meta → project →
 * global-meta → global）。
 *
 * @returns 不落在任何域前缀下时返回 `null`（调用方按无此文件处理）
 */
function resolvePhysicalPath(normalized: string): ResolvedPhysical | null {
  const session = normalized.match(
    /^\/projects\/([^/]+)\/sessions\/([^/]+)(\/.*)?$/,
  );
  if (session != null) {
    return {
      scope: {
        kind: "session",
        projectId: session[1]!,
        sessionId: session[2]!,
      },
      logicalPath: session[3] ?? "/",
    };
  }
  const projectMeta = normalized.match(/^\/projects\/([^/]+)\/meta(\/.*)?$/);
  if (projectMeta != null) {
    return {
      scope: { kind: "project-meta", projectId: projectMeta[1]! },
      logicalPath: projectMeta[2] ?? "/",
    };
  }
  const project = normalized.match(/^\/projects\/([^/]+)\/template(\/.*)?$/);
  if (project != null) {
    return {
      scope: { kind: "project", projectId: project[1]! },
      logicalPath: project[2] ?? "/",
    };
  }
  const globalMeta = normalized.match(/^\/meta(\/.*)?$/);
  if (globalMeta != null) {
    return { scope: { kind: "global-meta" }, logicalPath: globalMeta[1] ?? "/" };
  }
  const global = normalized.match(/^\/template(\/.*)?$/);
  if (global != null) {
    return { scope: { kind: "global" }, logicalPath: global[1] ?? "/" };
  }
  return null;
}

/** 目录行优先、再按路径字典序。 */
function compareEntries(a: VfsListEntry, b: VfsListEntry): number {
  if (a.kind !== b.kind) {
    return a.kind === "directory" ? -1 : 1;
  }
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/** 挂载点根的合成目录行（`/template`、`/meta`、`/projects` 域根无表行）。 */
function syntheticDir(path: string): VfsListEntry {
  return { path, kind: "directory" };
}

/** Default read-only physical VFS service. */
export class DefaultPhysicalVfsService implements PhysicalVfsService {
  private readonly entryRepo: SqliteVfsEntryRepository;
  private readonly projects: SqliteProjectRepository;
  private readonly sessions: SqliteSessionRepository;

  constructor(private readonly conn: TdbcConnection) {
    this.entryRepo = new SqliteVfsEntryRepository(conn);
    this.projects = new SqliteProjectRepository(conn);
    this.sessions = new SqliteSessionRepository(conn);
  }

  async list(physicalPath: string): Promise<VfsListEntry[]> {
    const normalized = resolveLogicalPath(physicalPath);

    // 物理根：三个域挂载点合成目录行（域内根级文件在各自挂载点下列出）
    if (normalized === "/") {
      return [
        syntheticDir("/meta"),
        syntheticDir("/projects"),
        syntheticDir("/template"),
      ];
    }

    if (normalized === "/projects") {
      const projects = await this.projects.list();
      return projects
        .map((p) => syntheticDir(`/projects/${p.id}`))
        .sort(compareEntries);
    }

    const projectsMatch = normalized.match(/^\/projects\/([^/]+)(\/.*)?$/);
    if (projectsMatch != null) {
      return this.listUnderProject(projectsMatch[1]!, projectsMatch[2]);
    }

    const metaMatch = normalized.match(/^\/meta(\/.*)?$/);
    if (metaMatch != null) {
      return this.listScopeFirstLevel(
        { kind: "global-meta" },
        metaMatch[1] ?? "/",
      );
    }

    const templateMatch = normalized.match(/^\/template(\/.*)?$/);
    if (templateMatch != null) {
      return this.listScopeFirstLevel(
        { kind: "global" },
        templateMatch[1] ?? "/",
      );
    }

    throw vfsNotFound(normalized);
  }

  async read(physicalPath: string): Promise<VfsReadResult> {
    const normalized = resolveLogicalPath(physicalPath);
    const resolved = resolvePhysicalPath(normalized);
    if (resolved == null) {
      throw vfsNotFound(normalized);
    }
    const result = await createScopedVfsService(
      this.conn,
      resolved.scope,
    ).read(resolved.logicalPath);
    const prefix = scopePhysicalPrefix(resolved.scope);
    return {
      ...result,
      path: resolved.logicalPath === "/" ? prefix : `${prefix}${resolved.logicalPath}`,
    };
  }

  /** `/projects/{pid}` 下的列目录分流（项目存在性在此校验）。 */
  private async listUnderProject(
    projectId: string,
    rest: string | undefined,
  ): Promise<VfsListEntry[]> {
    const project = await this.projects.findById(projectId);
    if (project == null) {
      throw vfsNotFound(`/projects/${projectId}`);
    }
    if (rest == null || rest === "/") {
      // 项目根：三个子域挂载点均合成目录行（空项目同样显示）
      return [
        syntheticDir(`/projects/${projectId}/template`),
        syntheticDir(`/projects/${projectId}/meta`),
        syntheticDir(`/projects/${projectId}/sessions`),
      ];
    }
    const sessionsMatch = rest.match(/^\/sessions(\/.*)?$/);
    if (sessionsMatch != null) {
      return this.listSessionsUnderProject(
        projectId,
        sessionsMatch[1] ?? "/",
      );
    }
    const metaMatch = rest.match(/^\/meta(\/.*)?$/);
    if (metaMatch != null) {
      return this.listScopeFirstLevel(
        { kind: "project-meta", projectId },
        metaMatch[1] ?? "/",
      );
    }
    const templateMatch = rest.match(/^\/template(\/.*)?$/);
    if (templateMatch != null) {
      return this.listScopeFirstLevel(
        { kind: "project", projectId },
        templateMatch[1] ?? "/",
      );
    }
    throw vfsNotFound(`/projects/${projectId}${rest}`);
  }

  /** `/projects/{pid}/sessions[/...]`：会话目录行枚举 + 会话域内列目录。 */
  private async listSessionsUnderProject(
    projectId: string,
    rest: string,
  ): Promise<VfsListEntry[]> {
    if (rest === "/") {
      // 主会话 + 子 agent 会话 BFS 展开；空项目返回空列表
      const ids: string[] = [];
      const queue = [...(await this.sessions.listByProject(projectId))];
      while (queue.length > 0) {
        const s = queue.shift()!;
        ids.push(s.id);
        queue.push(...(await this.sessions.listByParentSession(s.id)));
      }
      return ids
        .map((sid) => syntheticDir(`/projects/${projectId}/sessions/${sid}`))
        .sort(compareEntries);
    }
    const sidMatch = rest.match(/^\/([^/]+)(\/.*)?$/);
    if (sidMatch == null) {
      throw vfsNotFound(`/projects/${projectId}/sessions${rest}`);
    }
    const sessionId = sidMatch[1]!;
    const session = await this.sessions.findById(sessionId);
    if (session == null || session.projectId !== projectId) {
      throw vfsNotFound(`/projects/${projectId}/sessions/${sessionId}`);
    }
    return this.listScopeFirstLevel(
      { kind: "session", projectId, sessionId },
      sidMatch[2] ?? "/",
    );
  }

  /**
   * 单 scope 内列目录第一层：{@link SqliteVfsEntryRepository.listEntriesUnderPrefix}
   * 按索引取子树行后在应用层切直接子项，再拼物理前缀。
   */
  private async listScopeFirstLevel(
    scope: VfsScope,
    logicalDir: string,
  ): Promise<VfsListEntry[]> {
    const entries = await this.entryRepo.listEntriesUnderPrefix(
      scopeKey(scope),
      logicalDir,
    );
    const base = logicalDir === "/" ? "" : logicalDir;
    const firstLevel = new Map<string, "file" | "directory">();
    for (const entry of entries) {
      if (entry.path === logicalDir) {
        continue;
      }
      const relative = entry.path.slice(base.length + 1);
      if (relative.length === 0) {
        continue;
      }
      const name = relative.split("/")[0]!;
      const kind: "file" | "directory" = relative.includes("/")
        ? "directory"
        : entry.kind;
      // 隐含中间目录（无显式目录行）与显式目录行同名合并；文件行不与目录行同名
      const existing = firstLevel.get(name);
      if (existing !== "file") {
        firstLevel.set(name, kind);
      }
    }
    const prefix = scopePhysicalPrefix(scope);
    const dirPart = base === "" ? "" : base;
    return [...firstLevel]
      .map(([name, kind]) => ({ path: `${prefix}${dirPart}/${name}`, kind }))
      .sort(compareEntries);
  }
}
