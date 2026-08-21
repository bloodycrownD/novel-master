/**
 * DefaultSkillService：两域技能读写 / 合并视图 / 启停 / 复制删除。
 *
 * 文件读写走 ScopedVfsService（逻辑前缀 `/meta/skills/{name}/`），
 * 整目录删除走 repo 层 `sweepRevisionsUnderScope`
 * （同 project copy 的装配），负清单走 `skill_disabled_rule` repository。
 *
 * @module service/skills/impl/skills.service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { VfsService } from "@/domain/vfs/ports/vfs-service.port.js";
import type { VfsListEntry } from "@/domain/vfs/model/vfs-list-entry.js";
import { resolveLogicalPath } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { sweepRevisionsUnderScope } from "@/domain/vfs/logic/vfs-tree-copy.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";

import { isVfsError } from "@/errors/vfs-errors.js";
import {
  skillBuiltin,
  skillBuiltinNameReserved,
  skillInvalidName,
  skillInvalidPath,
  skillMissingDomain,
  skillMissingProjectId,
  skillNotFound,
} from "@/errors/skill-errors.js";
import { BUILTIN_SKILL_NAMES } from "@/bootstrap/skills/seed-builtin-skills.js";
import { parseSkillFrontMatter } from "@/domain/skills/logic/parse-skill-front-matter.js";
import { computeEffectiveSkills } from "@/domain/skills/logic/effective-skills.js";
import type {
  EffectiveSkill,
} from "@/domain/skills/logic/effective-skills.js";
import type { SkillDomain } from "@/domain/skills/model/skill.schema.js";
import { validateSkillName } from "@/domain/skills/model/skill-name.js";
import { SqliteSkillDisabledRuleRepository } from "@/domain/skills/repositories/impl/sqlite-skill-disabled-rule.repository.js";
import type { SkillDisabledRuleRepository } from "@/domain/skills/repositories/skill-disabled-rule.port.js";
import type {
  SkillEditMatch,
  SkillFileContent,
  SkillListItem,
  SkillListScope,
  SkillLocation,
  SkillService,
  SkillWriteOptions,
} from "../skills.port.js";

/** 两域技能的逻辑根前缀。 */
const SKILLS_ROOT = "/meta/skills";

/** 技能入口文件（path 缺省值）。 */
const SKILL_ENTRY_FILE = "SKILL.md";

/** Dependencies for {@link SkillsService}。 */
export interface SkillsServiceDeps {
  readonly conn: TdbcConnection;
  /** global-meta 域 VFS 惰性工厂（技能存储，逻辑前缀 /meta/skills/）。 */
  readonly globalMetaVfs: () => VfsService;
  /** project-meta 域 VFS 惰性工厂。 */
  readonly projectMetaVfs: (projectId: string) => VfsService;
  /** 负清单 repository（缺省用 SQLite 实现）。 */
  readonly disabledRules?: SkillDisabledRuleRepository;
}

/**
 * 把技能内相对路径解析为受控形态：缺省 SKILL.md，禁 `..` 段，
 * 归一化后必须仍在 `/meta/skills/{name}/` 内。
 *
 * @returns 相对技能目录的归一化路径。
 */
function resolveSkillRelPath(name: string, path: string | undefined): string {
  const raw = path ?? SKILL_ENTRY_FILE;
  if (raw.trim().length === 0) {
    throw skillInvalidPath(String(path), "技能文件路径不能为空");
  }
  // normalizePath 会把 `..` 消化成目录回溯而不是拒绝，这里必须先显式拦截，
  // 否则 `notes/../../other/SKILL.md` 会被静默解析进隔壁技能目录。
  if (raw.split("/").includes("..")) {
    throw skillInvalidPath(raw, "技能文件路径不得包含 ..");
  }
  const dirPrefix = `${SKILLS_ROOT}/${name}/`;
  const logical = resolveLogicalPath(`${dirPrefix}${raw}`);
  if (!logical.startsWith(dirPrefix)) {
    throw skillInvalidPath(raw, "技能文件路径必须位于技能目录内");
  }
  return logical.slice(dirPrefix.length);
}

/** 位置 → VFS meta 域 scopeKey（entry/revision 清理用；project 域缺 projectId 时抛错）。 */
function vfsScopeKeyOfLocation(location: SkillLocation): string {
  if (location.domain === "global") {
    return "global:meta";
  }
  if (location.projectId == null || location.projectId.length === 0) {
    throw skillMissingProjectId(location.name);
  }
  return `project:${location.projectId}:meta`;
}

/**
 * 位置 → 负清单 scopeKey。
 *
 * `skill_disabled_rule` 行的 scopeKey 语义固定为 `project:{pid}`
 * （setDisabled / effectiveSkills / 项目删除的 removeScope 同源），
 * 与 VFS 重定位到 meta 域无关，不得跟随改写。
 */
function disabledScopeKeyOfProject(projectId: string): string {
  return `project:${projectId}`;
}

/** 显式校验技能名（write/edit/copy 目标、delete 输入）。 */
function assertValidSkillName(name: string): void {
  const reason = validateSkillName(name);
  if (reason != null) {
    throw skillInvalidName(name, reason);
  }
}

/** 技能名不得含 `/`（防路径拼接逃逸；read 等只做该项弱校验）。 */
function assertNoPathSeparatorInName(name: string): void {
  if (name.includes("/")) {
    throw skillInvalidName(name, "技能名不能包含 /");
  }
}

/**
 * Default {@link SkillService}。
 */
export class SkillsService implements SkillService {
  constructor(private readonly deps: SkillsServiceDeps) {}

  private get disabledRules(): SkillDisabledRuleRepository {
    return (
      this.deps.disabledRules ??
      new SqliteSkillDisabledRuleRepository(this.deps.conn)
    );
  }

  private vfsForDomain(domain: SkillDomain, projectId?: string): VfsService {
    if (domain === "global") {
      return this.deps.globalMetaVfs();
    }
    if (projectId == null || projectId.length === 0) {
      throw skillMissingProjectId("");
    }
    return this.deps.projectMetaVfs(projectId);
  }

  private vfsForScope(scope: SkillListScope): { vfs: VfsService; domain: SkillDomain } {
    if (scope === "global") {
      return { vfs: this.deps.globalMetaVfs(), domain: "global" };
    }
    return {
      vfs: this.deps.projectMetaVfs(scope.projectId),
      domain: "project",
    };
  }

  async listSkills(scope: SkillListScope): Promise<SkillListItem[]> {
    const { vfs, domain } = this.vfsForScope(scope);
    let entries: VfsListEntry[];
    try {
      entries = await vfs.list(SKILLS_ROOT, { recursive: true });
    } catch (error) {
      // 技能根目录尚不存在 = 无技能（write 首个 SKILL.md 时才会建目录行）
      if (isVfsError(error, "NOT_FOUND")) {
        return [];
      }
      throw error;
    }

    const rootPrefix = `${SKILLS_ROOT}/`;
    const filesBySkill = new Map<string, string[]>();
    for (const entry of entries) {
      if (!entry.path.startsWith(rootPrefix)) {
        continue;
      }
      const rel = entry.path.slice(rootPrefix.length);
      const slash = rel.indexOf("/");
      if (slash < 0) {
        // 技能目录自身（或误放在技能根下的一级文件），不计入 files
        continue;
      }
      const skillName = rel.slice(0, slash);
      if (entry.kind !== "file") {
        continue;
      }
      const files = filesBySkill.get(skillName) ?? [];
      files.push(rel.slice(slash + 1));
      filesBySkill.set(skillName, files);
    }

    const items: SkillListItem[] = [];
    for (const [name, files] of filesBySkill) {
      items.push(await this.summarizeSkill(vfs, domain, name, files));
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
    return items;
  }

  /** 读取 SKILL.md 解析 front matter，拼清单条目（读不到按无效处理）。 */
  private async summarizeSkill(
    vfs: VfsService,
    domain: SkillDomain,
    name: string,
    files: string[],
  ): Promise<SkillListItem> {
    let source: string | null = null;
    if (files.includes(SKILL_ENTRY_FILE)) {
      const read = await vfs.read(`${SKILLS_ROOT}/${name}/${SKILL_ENTRY_FILE}`);
      source = read.content;
    }
    if (source == null) {
      return {
        name,
        description: null,
        domain,
        valid: false,
        invalidReason: "缺少 SKILL.md 入口文件",
        files: [...files].sort(),
      };
    }
    const parsed = parseSkillFrontMatter(source);
    return {
      name,
      description: parsed.description,
      domain,
      valid: parsed.valid,
      ...(parsed.invalidReason != null
        ? { invalidReason: parsed.invalidReason }
        : {}),
      files: [...files].sort(),
    };
  }

  async effectiveSkills(projectId: string): Promise<EffectiveSkill[]> {
    const [global, project, disabledNames] = await Promise.all([
      this.listSkills("global"),
      this.listSkills({ projectId }),
      this.disabledRules.listDisabledNames(`project:${projectId}`),
    ]);
    return computeEffectiveSkills({ global, project, disabledNames });
  }

  async readSkillFile(
    domain: SkillDomain | undefined,
    name: string,
    path?: string,
    projectId?: string,
  ): Promise<SkillFileContent> {
    assertNoPathSeparatorInName(name);
    const rel = resolveSkillRelPath(name, path);
    const candidates: SkillDomain[] =
      domain != null
        ? [domain]
        : projectId != null && projectId.length > 0
          ? ["project", "global"]
          : ["global"];
    for (const candidate of candidates) {
      const vfs = this.vfsForDomain(candidate, projectId);
      try {
        const result = await vfs.read(`${SKILLS_ROOT}/${name}/${rel}`);
        return {
          domain: candidate,
          name,
          path: rel,
          content: result.content,
          version: result.version,
        };
      } catch (error) {
        if (isVfsError(error, "NOT_FOUND")) {
          continue;
        }
        throw error;
      }
    }
    throw skillNotFound(name, rel);
  }

  async writeSkillFile(
    domain: SkillDomain | undefined,
    name: string,
    path: string | undefined,
    content: string,
    projectId?: string,
    options?: SkillWriteOptions,
  ): Promise<{ version: number }> {
    if (domain == null) {
      throw skillMissingDomain(name);
    }
    assertValidSkillName(name);
    const rel = resolveSkillRelPath(name, path);
    const vfs = this.vfsForDomain(domain, projectId);
    // D2②：内置保留名 + 该域目录不存在 = 新建，拒绝（目录已存在 = 编辑
    // 内置本体或历史副本，放行）。seed 通道带 builtinSeed 豁免首次种入；
    // 判定逻辑抽至 assertSkillNameNotReservedForCreate（ZIP 导入等第二条
    // 新建通道复用同一道门）。
    if (BUILTIN_SKILL_NAMES.has(name) && options?.builtinSeed !== true) {
      await this.assertSkillNameNotReservedForCreate(domain, name, projectId);
    }
    // write 对不存在的文件会自动补父目录——新建技能即向新目录写 SKILL.md。
    // 已存在文件（编辑）须带 expectedVersion 乐观锁，否则 VFS 拒绝（CONFLICT）。
    return vfs.write(`${SKILLS_ROOT}/${name}/${rel}`, content, {
      ...(options?.expectedVersion != null
        ? { expectedVersion: options.expectedVersion }
        : {}),
    });
  }

  async editSkillFile(
    domain: SkillDomain | undefined,
    name: string,
    path: string | undefined,
    match: SkillEditMatch,
    projectId?: string,
  ): Promise<{ version: number; replacements: number }> {
    if (domain == null) {
      throw skillMissingDomain(name);
    }
    assertValidSkillName(name);
    const rel = resolveSkillRelPath(name, path);
    const vfs = this.vfsForDomain(domain, projectId);
    // replace 底层走 compute-replace-result（normalize-for-match 定位），
    // 与 edit 工具同一套匹配语义
    return vfs.replace(
      `${SKILLS_ROOT}/${name}/${rel}`,
      match.oldString,
      match.newString,
      { replaceAll: match.replaceAll },
    );
  }

  async setDisabled(
    projectId: string,
    name: string,
    disabled: boolean,
  ): Promise<void> {
    assertValidSkillName(name);
    const scopeKey = disabledScopeKeyOfProject(projectId);
    if (disabled) {
      await this.disabledRules.upsert(scopeKey, name);
    } else {
      await this.disabledRules.remove(scopeKey, name);
    }
  }

  async deleteSkill(location: SkillLocation): Promise<void> {
    assertValidSkillName(location.name);
    // D2①：global 域内置名不可删（project 域历史同名副本仍可删）。
    if (
      location.domain === "global" &&
      BUILTIN_SKILL_NAMES.has(location.name)
    ) {
      throw skillBuiltin(location.name);
    }
    // VFS 清理用 meta 域 key；负清单行的 scopeKey 仍是 project:{pid}，两者分开取
    const vfsScopeKey = vfsScopeKeyOfLocation(location);
    const prefix = `${SKILLS_ROOT}/${location.name}`;

    // 存在性检查放事务外（避免错误被事务包装器包裹）。
    await this.assertSkillDirExists(
      new SqliteVfsEntryRepository(this.deps.conn),
      vfsScopeKey,
      prefix,
    );

    await this.deps.conn.transaction(async (tx) => {
      const entryRepo = new SqliteVfsEntryRepository(tx);
      const revisionRepo = new SqliteVfsRevisionRepository(tx);
      await sweepRevisionsUnderScope(entryRepo, revisionRepo, vfsScopeKey, prefix);

      // 连带清理负清单行：project 域只清本项目行；global 域清所有项目行，
      // 否则会留下指向不存在技能的孤儿禁用行。
      const ruleRepo = new SqliteSkillDisabledRuleRepository(tx);
      if (location.domain === "project") {
        if (location.projectId == null || location.projectId.length === 0) {
          throw skillMissingProjectId(location.name);
        }
        await ruleRepo.remove(
          disabledScopeKeyOfProject(location.projectId),
          location.name,
        );
      } else {
        await ruleRepo.removeAllScopesByName(location.name);
      }
    });
  }

  /**
   * 新建语义的内置保留名门（D2②，writeSkillFile 同源判定独立暴露）：
   *
   * 名单外直接放行；名单内且该域技能目录不存在（= 新建语义）抛
   * `SkillError(BUILTIN_SKILL_NAME_RESERVED)`（中文文案）；目录已存在
   * （编辑内置本体或历史副本）放行。ZIP 导入等不经 writeSkillFile 的
   * 新建通道，落盘前须先过这道门（CR D-1）。project 域须带 projectId
   * （缺失抛 `SkillError(MISSING_PROJECT_ID)`）。
   */
  async assertSkillNameNotReservedForCreate(
    domain: SkillDomain,
    name: string,
    projectId?: string,
  ): Promise<void> {
    if (!BUILTIN_SKILL_NAMES.has(name)) {
      return;
    }
    if (domain === "project" && (projectId == null || projectId.length === 0)) {
      throw skillMissingProjectId(name);
    }
    const scopeKey =
      domain === "global" ? "global:meta" : `project:${projectId}:meta`;
    const dirExists = await this.skillDirExists(
      new SqliteVfsEntryRepository(this.deps.conn),
      scopeKey,
      `${SKILLS_ROOT}/${name}`,
    );
    if (!dirExists) {
      throw skillBuiltinNameReserved(name);
    }
  }

  /** 技能目录存在性判定（目录行或其下任一 entry 存在即视为存在）。 */
  private async skillDirExists(
    entryRepo: SqliteVfsEntryRepository,
    scopeKey: string,
    prefix: string,
  ): Promise<boolean> {
    const entries = await entryRepo.listEntriesUnderPrefix(scopeKey, prefix);
    return entries.some(
      (entry) =>
        entry.path === prefix || entry.path.startsWith(`${prefix}/`),
    );
  }

  /** 技能目录不存在时抛 NOT_FOUND（存在性判定与 writeSkillFile 新建拦截同源）。 */
  private async assertSkillDirExists(
    entryRepo: SqliteVfsEntryRepository,
    scopeKey: string,
    prefix: string,
  ): Promise<void> {
    if (!(await this.skillDirExists(entryRepo, scopeKey, prefix))) {
      throw skillNotFound(prefix.slice(SKILLS_ROOT.length + 1));
    }
  }
}
