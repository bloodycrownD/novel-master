/**
 * 只读物理树服务实现。
 *
 * 存储层零改动：`vfs_entry` 仍按 (scope_key, 逻辑 path) 存行；本服务在应用层
 * 把各域行拼成统一物理视图——global 拼 `/template`、global-meta 拼 `/meta`、
 * project 拼 `/projects/{pid}/template`、project-meta 拼 `/projects/{pid}/meta`、
 * session 拼 `/projects/{pid}/sessions/{sid}`。注意 meta 两域的域内逻辑路径
 * 自带 `/meta` 段（SkillsService 约定写 `/meta/skills/...`），挂载前缀分别为
 * 空串与 `/projects/{pid}`。列目录按目标 scope 逐个
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
import type { ChatSession } from "@/domain/chat/model/session.js";
import type { VfsListEntry } from "@/domain/vfs/model/vfs-list-entry.js";
import type { VfsReadResult } from "@/domain/vfs/ports/vfs-service.port.js";
import { isVfsError, vfsNotFound } from "@/errors/vfs-errors.js";
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
    /^\/projects\/([^/]+)\/sessions\/([^/]+)(\/.*)?$/
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
    // project-meta 域内逻辑路径自带 /meta 段：剥掉 /projects/{pid} 挂载段、
    // 保留 /meta/...（否则会拼出 /projects/{pid}/projects 废路径）
    return {
      scope: { kind: "project-meta", projectId: projectMeta[1]! },
      logicalPath: `/meta${projectMeta[2] ?? ""}`,
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
    // global-meta 物理 = 逻辑原样（域内逻辑路径自带 /meta 段，前缀空串），
    // 不得再剥挂载段（否则 /meta 会自指循环）
    return { scope: { kind: "global-meta" }, logicalPath: normalized };
  }
  const global = normalized.match(/^\/template(\/.*)?$/);
  if (global != null) {
    return { scope: { kind: "global" }, logicalPath: global[1] ?? "/" };
  }
  return null;
}

/** 路径末段（basename），无 label 行的排序回退键。 */
function basenameOf(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

/** 目录行优先、再按展示键（label，无则路径末段）字典序；合成行按项目名/会话名排而非 UUID。 */
function compareEntries(a: VfsListEntry, b: VfsListEntry): number {
  if (a.kind !== b.kind) {
    return a.kind === "directory" ? -1 : 1;
  }
  const ka = a.label ?? basenameOf(a.path);
  const kb = b.label ?? basenameOf(b.path);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/** 挂载点根的合成目录行（`/template`、`/meta`、`/projects` 域根无表行）。 */
function syntheticDir(path: string, label?: string): VfsListEntry {
  return label == null
    ? { path, kind: "directory" }
    : { path, kind: "directory", label };
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
        .map((p) => syntheticDir(`/projects/${p.id}`, p.name))
        .sort(compareEntries);
    }

    const projectsMatch = normalized.match(/^\/projects\/([^/]+)(\/.*)?$/);
    if (projectsMatch != null) {
      return this.listUnderProject(projectsMatch[1]!, projectsMatch[2]);
    }

    const metaMatch = normalized.match(/^\/meta(\/.*)?$/);
    if (metaMatch != null) {
      // global-meta：物理目录即域内逻辑目录（逻辑路径自带 /meta 段）
      return this.listScopeFirstLevel({ kind: "global-meta" }, normalized);
    }

    const templateMatch = normalized.match(/^\/template(\/.*)?$/);
    if (templateMatch != null) {
      return this.listScopeFirstLevel({ kind: "global" }, normalized);
    }

    throw vfsNotFound(normalized);
  }

  /**
   * 批量列物理目录下全部层级的行（路由与 {@link list} 一致，
   * 详见 port 注释；每个 scope 一次前缀查询后应用层递归切层）。
   */
  async listTree(physicalPath: string): Promise<VfsListEntry[]> {
    const normalized = resolveLogicalPath(physicalPath);

    if (normalized === "/") {
      const rows = [
        syntheticDir("/meta"),
        syntheticDir("/projects"),
        syntheticDir("/template"),
      ];
      rows.push(
        ...(await this.scopeTreeRows({ kind: "global-meta" }, "/meta"))
      );
      rows.push(...(await this.scopeTreeRows({ kind: "global" }, "/template")));
      rows.push(...(await this.projectsTreeRows()));
      return rows.sort(compareEntries);
    }

    if (normalized === "/projects") {
      return (await this.projectsTreeRows()).sort(compareEntries);
    }

    const projectsMatch = normalized.match(/^\/projects\/([^/]+)(\/.*)?$/);
    if (projectsMatch != null) {
      const projectId = projectsMatch[1]!;
      const project = await this.projects.findById(projectId);
      if (project == null) {
        throw vfsNotFound(`/projects/${projectId}`);
      }
      return (await this.projectTreeRows(projectId, projectsMatch[2])).sort(
        compareEntries
      );
    }

    const metaMatch = normalized.match(/^\/meta(\/.*)?$/);
    if (metaMatch != null) {
      return (
        await this.scopeTreeRows({ kind: "global-meta" }, normalized)
      ).sort(compareEntries);
    }

    const templateMatch = normalized.match(/^\/template(\/.*)?$/);
    if (templateMatch != null) {
      return (await this.scopeTreeRows({ kind: "global" }, normalized)).sort(
        compareEntries
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
    let result: VfsReadResult;
    try {
      result = await createScopedVfsService(this.conn, resolved.scope).read(
        resolved.logicalPath
      );
    } catch (error) {
      // 挂载点根等目录行按「无此文件」归一（本视图 read 只面向文件）
      if (isVfsError(error, "IS_DIRECTORY")) {
        throw vfsNotFound(normalized);
      }
      throw error;
    }
    const prefix = scopePhysicalPrefix(resolved.scope);
    return {
      ...result,
      path:
        resolved.logicalPath === "/"
          ? prefix
          : `${prefix}${resolved.logicalPath}`,
    };
  }

  /** `/projects/{pid}` 下的列目录分流（项目存在性在此校验）。 */
  private async listUnderProject(
    projectId: string,
    rest: string | undefined
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
      return this.listSessionsUnderProject(projectId, sessionsMatch[1] ?? "/");
    }
    const metaMatch = rest.match(/^\/meta(\/.*)?$/);
    if (metaMatch != null) {
      // project-meta：传物理形态目录（逻辑路径自带 /meta 段，挂载前缀仅项目段）
      return this.listScopeFirstLevel(
        { kind: "project-meta", projectId },
        `/projects/${projectId}${rest}`
      );
    }
    const templateMatch = rest.match(/^\/template(\/.*)?$/);
    if (templateMatch != null) {
      return this.listScopeFirstLevel(
        { kind: "project", projectId },
        `/projects/${projectId}${rest}`
      );
    }
    throw vfsNotFound(`/projects/${projectId}${rest}`);
  }

  /** 会话域内是否有任意 VFS 条目（用于过滤无工作区文件的子 agent 会话）。 */
  private async hasSessionEntries(
    projectId: string,
    sessionId: string
  ): Promise<boolean> {
    const entries = await this.entryRepo.listEntriesUnderPrefix(
      scopeKey({ kind: "session", projectId, sessionId }),
      "/"
    );
    return entries.length > 0;
  }

  /** `/projects/{pid}/sessions[/...]`：会话目录行枚举 + 会话域内列目录。 */
  private async listSessionsUnderProject(
    projectId: string,
    rest: string
  ): Promise<VfsListEntry[]> {
    if (rest === "/") {
      // 主会话 + 子 agent 会话 BFS 展开；空项目返回空列表。
      // title 为 null（未命名会话）不填 label，展示层回退 UUID。
      // 主会话无条件显示（PRD：空会话也显示目录行）；子 agent 会话共享
      // 父会话 VFS、本无独立工作区，仅当存在历史残留条目时才显示，
      // 否则会堆出一排无意义的空目录。
      const sessions: ChatSession[] = [];
      const queue = [...(await this.sessions.listByProject(projectId))];
      while (queue.length > 0) {
        const s = queue.shift()!;
        sessions.push(s);
        queue.push(...(await this.sessions.listByParentSession(s.id)));
      }
      const withVisibility = await Promise.all(
        sessions.map(async (s) => ({
          s,
          visible:
            s.parentSessionId == null ||
            (await this.hasSessionEntries(projectId, s.id)),
        }))
      );
      return withVisibility
        .filter(({ visible }) => visible)
        .map(({ s }) =>
          syntheticDir(
            `/projects/${projectId}/sessions/${s.id}`,
            s.title ?? undefined
          )
        )
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
      `/projects/${projectId}/sessions/${sessionId}${sidMatch[2] ?? ""}`
    );
  }

  /**
   * 单 scope 内列目录第一层。
   *
   * 入参 `physicalDir` 为**物理形态目录**（global-meta 即 `/meta...`、
   * project-meta 即 `/projects/{pid}/meta...`）：查询前缀由它剥掉挂载前缀得到
   * （meta 两域域内逻辑路径自带 `/meta` 段，其余域为挂载段之下的相对路径），
   * {@link SqliteVfsEntryRepository.listEntriesUnderPrefix} 按索引取子树行后
   * 以 `physicalDir` 为 base 切直接子项，输出 `base + '/' + name`——
   * 即 list 链路中挂载前缀退化为 base 本身，仅 read 输出 path 拼装仍用前缀。
   */
  private async listScopeFirstLevel(
    scope: VfsScope,
    physicalDir: string
  ): Promise<VfsListEntry[]> {
    const prefix = scopePhysicalPrefix(scope);
    const restDir = physicalDir.slice(prefix.length);
    const queryDir = restDir === "" ? "/" : restDir;
    const entries = await this.entryRepo.listEntriesUnderPrefix(
      scopeKey(scope),
      queryDir
    );
    const base = queryDir === "/" ? "" : queryDir;
    const firstLevel = new Map<string, "file" | "directory">();
    for (const entry of entries) {
      if (entry.path === queryDir) {
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
    return [...firstLevel]
      .map(([name, kind]) => ({ path: `${physicalDir}/${name}`, kind }))
      .sort(compareEntries);
  }

  /**
   * 单 scope 子树全量行：一次 {@link
   * SqliteVfsEntryRepository.listEntriesUnderPrefix} 前缀查询后，
   * 在应用层按段递归切出**全部层级**行（含隐含中间目录行，供 BFS 全树
   * 一次消费）。`physicalDir` 语义同 {@link listScopeFirstLevel}。
   */
  private async scopeTreeRows(
    scope: VfsScope,
    physicalDir: string
  ): Promise<VfsListEntry[]> {
    const prefix = scopePhysicalPrefix(scope);
    const restDir = physicalDir.slice(prefix.length);
    const queryDir = restDir === "" ? "/" : restDir;
    const entries = await this.entryRepo.listEntriesUnderPrefix(
      scopeKey(scope),
      queryDir
    );
    const base = queryDir === "/" ? "" : queryDir;
    // path → kind；同名合并规则与 listScopeFirstLevel 一致（已有文件行不被目录行覆盖）
    const rows = new Map<string, "file" | "directory">();
    for (const entry of entries) {
      if (entry.path === queryDir) {
        continue;
      }
      const relative = entry.path.slice(base.length + 1);
      if (relative.length === 0) {
        continue;
      }
      const segments = relative.split("/");
      // 先补齐隐含中间目录行，再落条目自身
      let acc = physicalDir;
      for (let i = 0; i < segments.length - 1; i++) {
        acc = `${acc}/${segments[i]!}`;
        if (rows.get(acc) !== "file") {
          rows.set(acc, "directory");
        }
      }
      const entryPath = `${acc}/${segments[segments.length - 1]!}`;
      if (rows.get(entryPath) !== "file") {
        rows.set(entryPath, entry.kind);
      }
    }
    return [...rows]
      .map(([path, kind]) => ({ path, kind }))
      .sort(compareEntries);
  }

  /** `/projects` 全部项目子树（含项目目录行，虚拟目录合成）。 */
  private async projectsTreeRows(): Promise<VfsListEntry[]> {
    const projects = await this.projects.list();
    const rows: VfsListEntry[] = [];
    for (const p of projects) {
      rows.push(syntheticDir(`/projects/${p.id}`, p.name));
      rows.push(...(await this.projectTreeRows(p.id, "/")));
    }
    return rows;
  }

  /** `/projects/{pid}` 子树（rest 语义同 listUnderProject；不含项目目录行自身）。 */
  private async projectTreeRows(
    projectId: string,
    rest: string | undefined
  ): Promise<VfsListEntry[]> {
    if (rest == null || rest === "/") {
      // 项目根：三个子域挂载点目录行 + 各子树
      const rows = [
        syntheticDir(`/projects/${projectId}/template`),
        syntheticDir(`/projects/${projectId}/meta`),
        syntheticDir(`/projects/${projectId}/sessions`),
      ];
      rows.push(
        ...(await this.scopeTreeRows(
          { kind: "project", projectId },
          `/projects/${projectId}/template`
        ))
      );
      rows.push(
        ...(await this.scopeTreeRows(
          { kind: "project-meta", projectId },
          `/projects/${projectId}/meta`
        ))
      );
      rows.push(...(await this.sessionsTreeRows(projectId, "/")));
      return rows;
    }
    const sessionsMatch = rest.match(/^\/sessions(\/.*)?$/);
    if (sessionsMatch != null) {
      return this.sessionsTreeRows(projectId, sessionsMatch[1]!);
    }
    const metaMatch = rest.match(/^\/meta(\/.*)?$/);
    if (metaMatch != null) {
      return this.scopeTreeRows(
        { kind: "project-meta", projectId },
        `/projects/${projectId}${rest}`
      );
    }
    const templateMatch = rest.match(/^\/template(\/.*)?$/);
    if (templateMatch != null) {
      return this.scopeTreeRows(
        { kind: "project", projectId },
        `/projects/${projectId}${rest}`
      );
    }
    throw vfsNotFound(`/projects/${projectId}${rest}`);
  }

  /** `/projects/{pid}/sessions[/...]` 子树（主会话 + 子 agent 会话 BFS 展开）。 */
  private async sessionsTreeRows(
    projectId: string,
    rest: string
  ): Promise<VfsListEntry[]> {
    if (rest === "/") {
      // 空项目返回空列表；子会话目录行与其子树均 BFS 展平。
      // 子 agent 会话仅当存在 VFS 条目（历史残留）时才输出（同 list 侧
      // 过滤语义），避免空目录刷屏。
      const rows: VfsListEntry[] = [];
      const queue = [...(await this.sessions.listByProject(projectId))];
      while (queue.length > 0) {
        const s = queue.shift()!;
        queue.push(...(await this.sessions.listByParentSession(s.id)));
        if (s.parentSessionId != null) {
          const hasEntries = await this.hasSessionEntries(projectId, s.id);
          if (!hasEntries) {
            continue;
          }
        }
        rows.push(
          syntheticDir(
            `/projects/${projectId}/sessions/${s.id}`,
            s.title ?? undefined
          )
        );
        rows.push(
          ...(await this.scopeTreeRows(
            { kind: "session", projectId, sessionId: s.id },
            `/projects/${projectId}/sessions/${s.id}`
          ))
        );
      }
      return rows;
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
    return this.scopeTreeRows(
      { kind: "session", projectId, sessionId },
      `/projects/${projectId}/sessions/${sessionId}${sidMatch[2] ?? ""}`
    );
  }
}
