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
import type { LongTaskHooks } from "@/domain/abort/model/abort-scope.js";
import { assert } from "@/common/assert.js";
import { VfsTreeCopy } from "@/domain/vfs/logic/vfs-tree-copy.js";
import { DeferredBlobGc } from "@/domain/vfs/logic/deferred-blob-gc.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";

import { AppError, isAppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { Outcome } from "@/errors/outcome.js";
import type { CoreMessageDescriptor } from "@/i18n/keys.js";
import { TdbcError } from "@/infra/tdbc/index.js";
import { BUILTIN_SKILL_NAMES } from "@/bootstrap/skills/seed-builtin-skills.js";
import { parseSkillFrontMatter } from "@/domain/skills/logic/parse-skill-front-matter.js";
import { SKILL_ENTRY_FILE, SKILLS_ROOT, resolveSkillRelPathCore } from "@/domain/skills/logic/skill-paths.js";
import { withSkillFrontMatterValues } from "@/domain/skills/logic/with-skill-front-matter-values.js";
import { computeEffectiveSkills } from "@/domain/skills/logic/effective-skills.js";
import type { EffectiveSkill } from "@/domain/skills/logic/effective-skills.js";
import type { SkillDomain } from "@/domain/skills/model/skill.schema.js";
import { validateSkillName } from "@/domain/skills/model/skill-name.js";
import { SqliteSkillDisabledRuleRepository } from "@/domain/skills/repositories/impl/sqlite-skill-disabled-rule.repository.js";
import type { SkillDisabledRuleRepository } from "@/domain/skills/repositories/skill-disabled-rule.port.js";
import { VfsServiceFactory } from "@/service/vfs/vfs-service-factory.js";
import { unwrapOrRollback } from "@/infra/tdbc/logic/transaction-helper.js";
import type { SkillEditMatch, SkillFileContent, SkillInfoChanges, SkillListItem, SkillListScope, SkillLocation, SkillService, SkillWriteOptions } from "../skills.port.js";

/** Dependencies for {@link SkillsService}。 */
interface SkillsServiceDeps {
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
 * 纯逻辑在 domain 层 `skill-paths.ts`（tool 层同路径串行化分类器共用
 * 同一内核），这里只包装成 `AppError(SKILL_INVALID_PATH)`。
 *
 * @returns Ok = 相对技能目录的归一化路径；Err = 路径非法（域校验，A 类）。
 */
function resolveSkillRelPath(name: string, path: string | undefined): Result<string, AppError> {
  const resolved = resolveSkillRelPathCore(name, path);
  if (resolved.ok) {
    return Result.ok(resolved.rel);
  }
  if (resolved.reason === "cross_root") {
    return Result.err(resolved.error);
  }
  const reason: CoreMessageDescriptor = { key: `error.skill.invalid_path.${resolved.reason}` };
  return Result.err(new AppError("SKILL_INVALID_PATH", { descriptor: reason, path: String(path ?? SKILL_ENTRY_FILE) }));
}

/** 位置 → VFS meta 域 scopeKey（entry/revision 清理用；project 域缺 projectId 返回 Err）。 */
function vfsScopeKeyOfLocation(location: SkillLocation): Result<string, AppError> {
  if (location.domain === "global") {
    return Result.ok("global:meta");
  }
  if (location.projectId == null || location.projectId.length === 0) {
    return Result.err(new AppError("SKILL_MISSING_PROJECT_ID", { descriptor: { key: "error.skill.missing_project_id", params: { skill_name: location.name } }, skillName: location.name }));
  }
  return Result.ok(`project:${location.projectId}:meta`);
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

/** 显式校验技能名（write/edit/copy 目标、delete 输入）；非法返回 Err(SKILL_INVALID_NAME)。 */
function assertValidSkillName(name: string): Result<void, AppError> {
  const reason = validateSkillName(name);
  if (reason != null) {
    return Result.err(new AppError("SKILL_INVALID_NAME", { descriptor: reason, skillName: name }));
  }
  return Result.ok(undefined);
}

/** writeSkillFile / editSkillFile 的返回通道（端口契约）。 */
type WriteSkillResult = Promise<Result<{ version: number }, AppError>>;
type EditSkillResult = Promise<Result<{ version: number; replacements: number }, AppError>>;

/**
 * Default {@link SkillService}。
 */
export class SkillsService implements SkillService {
  constructor(private readonly deps: SkillsServiceDeps) {}

  private get disabledRules(): SkillDisabledRuleRepository {
    return this.deps.disabledRules ?? new SqliteSkillDisabledRuleRepository(this.deps.conn);
  }

  private vfsForDomain(domain: SkillDomain, projectId?: string): Result<VfsService, AppError> {
    if (domain === "global") {
      return Result.ok(this.deps.globalMetaVfs());
    }
    if (projectId == null || projectId.length === 0) {
      return Result.err(new AppError("SKILL_MISSING_PROJECT_ID", { descriptor: { key: "error.skill.missing_project_id", params: { skill_name: "" } }, skillName: "" }));
    }
    return Result.ok(this.deps.projectMetaVfs(projectId));
  }

  /**
   * 写路径的 NOT_FOUND 转成可操作文案。
   *
   * WHY：edit/write 的域由调用方显式给，失败通常是「域选错」而非「技能不存在」。
   * 裸 VfsError 会把 `Path not found: /meta/skills/...` 抛给调用方，既泄漏内部
   * 逻辑路径，也看不出该补 domain 参数——模型据此无法自我修复。
   *
   * 另一域探测是三态：`true/false` = 存在/不存在；`null` = **无法确认**（project
   * 域缺 projectId 时无从探测）。把「查不了」说成「没有」会误导调用方去错误的
   * 方向新建，所以三态不可并成两态。
   */
  private async toWriteNotFoundError(error: unknown, name: string, path: string, domain: SkillDomain, projectId?: string): Promise<AppError<"SKILL_NOT_FOUND">> {
    if (!isAppError(error, "VFS_NOT_FOUND")) {
      throw error;
    }
    const otherDomain: SkillDomain = domain === "global" ? "project" : "global";
    let exists: boolean | null;
    if (otherDomain === "project" && (projectId == null || projectId.length === 0)) {
      exists = null;
    } else {
      // 错误通道迁移四期适配：vfs.read 已改返回 Result、不再以 throw 报 NOT_FOUND——
      // 旧的 try/catch 判定会永远走 return true（探测恒真），错误提示「切另一域」。
      const otherVfs = this.vfsForDomain(otherDomain, projectId);
      exists = otherVfs.ok ? (await otherVfs.value.read(`${SKILLS_ROOT}/${name}/${path}`)).ok : null;
    }
    // 写失败文案必须带命中域与另一域存在性（hint 嵌套 descriptor，spec G1.4）：
    // 裸 VFS 的 `Path not found: /meta/skills/...` 既认不出是域选错，也无从知道
    // 该补什么。exists: null 表示**无法确认**另一域（如未提供 projectId），
    // 此时不得断言该域没有该技能 → probe_failed hint。
    let hint: CoreMessageDescriptor;
    if (exists === true) {
      hint = { key: "error.skill.not_found_in_domain_hint.other_domain", params: { other_domain: otherDomain } };
    } else if (exists === false) {
      hint = { key: "error.skill.not_found_in_domain_hint.neither_domain", params: { domain, other_domain: otherDomain } };
    } else {
      hint = { key: "error.skill.not_found_in_domain_hint.probe_failed", params: { other_domain: otherDomain } };
    }
    return new AppError("SKILL_NOT_FOUND", { descriptor: { key: "error.skill.not_found_in_domain", params: { name, domain, path, hint } }, skillName: name, path, domain });
  }

  async listSkills(scope: SkillListScope, hooks?: LongTaskHooks): Promise<Outcome<SkillListItem[]>> {
    const vfs = scope === "global" ? this.deps.globalMetaVfs() : this.deps.projectMetaVfs(scope.projectId);
    const domain: SkillDomain = scope === "global" ? "global" : "project";
    const listed = await vfs.list(SKILLS_ROOT, { recursive: true });
    let entries: VfsListEntry[];
    if (listed.ok) {
      entries = listed.value;
    } else if (isAppError(listed.error, "VFS_NOT_FOUND")) {
      // 技能根目录尚不存在 = 无技能（write 首个 SKILL.md 时才会建目录行）
      return { kind: "completed", value: [] };
    } else {
      // 其余清单读取失败沿返回值接力（五期门⑦），由调用方收口。
      return { kind: "failed", error: listed.error };
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
      // 每个技能一条同步检查点：命中即收成中断，不返回半份清单。
      const hit = hooks?.checkpoint?.();
      if (hit != null) return hit;
      // 读取 SKILL.md 解析 front matter，拼清单条目（读不到按无效处理）。
      let source: string | null = null;
      if (files.includes(SKILL_ENTRY_FILE)) {
        const read = await vfs.read(`${SKILLS_ROOT}/${name}/${SKILL_ENTRY_FILE}`);
        if (read.ok) {
          source = read.value.content;
        }
      }
      if (source == null) {
        items.push({
          name,
          description: null,
          domain,
          valid: false,
          invalidReason: { key: "error.skill.entry_file_missing" },
          files: [...files].sort(),
        });
        continue;
      }
      const parsed = parseSkillFrontMatter(source);
      items.push({
        name,
        description: parsed.description,
        domain,
        valid: parsed.valid,
        ...(parsed.invalidReason != null ? { invalidReason: parsed.invalidReason } : {}),
        files: [...files].sort(),
      });
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
    return { kind: "completed", value: items };
  }

  async effectiveSkills(projectId: string): Promise<Result<EffectiveSkill[], AppError>> {
    const [global, project, disabledNames] = await Promise.all([this.listSkills("global"), this.listSkills({ projectId }), this.disabledRules.listDisabledNames(`project:${projectId}`)]);
    if (global.kind === "failed") return Result.err(global.error);
    if (project.kind === "failed") return Result.err(project.error);
    // 本方法不注入 hooks，listSkills 不会产生中断；命中说明调用链被改动（不变量破坏）。
    assert(global.kind === "completed" && project.kind === "completed", "effectiveSkills 不注入 hooks，listSkills 不应产生中断");
    return Result.ok(computeEffectiveSkills({ global: global.value, project: project.value, disabledNames }));
  }

  async readSkillFile(domain: SkillDomain | undefined, name: string, path?: string, projectId?: string): Promise<Result<SkillFileContent, AppError>> {
    // 技能名不得含 `/`（防路径拼接逃逸；read 等只做该项弱校验）。
    if (name.includes("/")) {
      return Result.err(new AppError("SKILL_INVALID_NAME", { descriptor: { key: "error.skill.invalid_name.slash" }, skillName: name }));
    }
    const rel = resolveSkillRelPath(name, path);
    if (!rel.ok) return Result.err(rel.error);
    const relPath = rel.value;
    const candidates: SkillDomain[] = domain != null ? [domain] : projectId != null && projectId.length > 0 ? ["project", "global"] : ["global"];
    for (const candidate of candidates) {
      const vfsRes = this.vfsForDomain(candidate, projectId);
      if (!vfsRes.ok) return Result.err(vfsRes.error);
      const vfs = vfsRes.value;
      const result = await vfs.read(`${SKILLS_ROOT}/${name}/${relPath}`);
      if (result.ok) {
        return Result.ok({
          domain: candidate,
          name,
          path: relPath,
          content: result.value.content,
          version: result.value.version,
        });
      }
      if (isAppError(result.error, "VFS_NOT_FOUND")) {
        continue;
      }
      return Result.err(result.error);
    }
    return Result.err(new AppError("SKILL_NOT_FOUND", { detail: `Skill file not found: ${name}/${relPath}`, skillName: name, path: relPath }));
  }

  async writeSkillFile(domain: SkillDomain | undefined, name: string, path: string | undefined, content: string, projectId?: string, options?: SkillWriteOptions): WriteSkillResult {
    if (domain == null) {
      return Result.err(new AppError("SKILL_MISSING_DOMAIN", { descriptor: { key: "error.skill.missing_domain", params: { skill_name: name } }, skillName: name }));
    }
    const nameOk = assertValidSkillName(name);
    if (!nameOk.ok) return Result.err(nameOk.error);
    const rel = resolveSkillRelPath(name, path);
    if (!rel.ok) return Result.err(rel.error);
    const vfsRes = this.vfsForDomain(domain, projectId);
    if (!vfsRes.ok) return Result.err(vfsRes.error);
    const vfs = vfsRes.value;
    // D2②：内置保留名 + 该域目录不存在 = 新建，拒绝（目录已存在 = 编辑
    // 内置本体或历史副本，放行）。seed 通道带 builtinSeed 豁免首次种入；
    // 判定逻辑抽至 assertSkillNameNotReservedForCreate（ZIP 导入等第二条
    // 新建通道复用同一道门）。
    if (BUILTIN_SKILL_NAMES.has(name) && options?.builtinSeed !== true) {
      const reserved = await this.assertSkillNameNotReservedForCreate(domain, name, projectId);
      if (!reserved.ok) return Result.err(reserved.error);
    }
    // write 对不存在的文件会自动补父目录——新建技能即向新目录写 SKILL.md。
    // 版本比对已从 VFS 底层移除：last-write-wins。
    const written = await vfs.write(`${SKILLS_ROOT}/${name}/${rel.value}`, content);
    if (written.ok) {
      return Result.ok(written.value);
    }
    return Result.err(await this.toWriteNotFoundError(written.error, name, rel.value, domain, projectId));
  }

  /** nm-style: keep-public — SkillService 端口方法；skill-tool 的 edit 动作单点消费。 */
  async editSkillFile(domain: SkillDomain | undefined, name: string, path: string | undefined, match: SkillEditMatch, projectId?: string): EditSkillResult {
    if (domain == null) {
      return Result.err(new AppError("SKILL_MISSING_DOMAIN", { descriptor: { key: "error.skill.missing_domain", params: { skill_name: name } }, skillName: name }));
    }
    const nameOk = assertValidSkillName(name);
    if (!nameOk.ok) return Result.err(nameOk.error);
    const rel = resolveSkillRelPath(name, path);
    if (!rel.ok) return Result.err(rel.error);
    const vfsRes = this.vfsForDomain(domain, projectId);
    if (!vfsRes.ok) return Result.err(vfsRes.error);
    const vfs = vfsRes.value;
    // replace 底层走 compute-replace-result（normalize-for-match 定位），
    // 与 edit 工具同一套匹配语义
    const replaced = await vfs.replace(`${SKILLS_ROOT}/${name}/${rel.value}`, match.oldString, match.newString, { replaceAll: match.replaceAll });
    if (replaced.ok) {
      return Result.ok(replaced.value);
    }
    return Result.err(await this.toWriteNotFoundError(replaced.error, name, rel.value, domain, projectId));
  }

  async setDisabled(projectId: string, name: string, disabled: boolean): Promise<Result<void, AppError>> {
    const nameOk = assertValidSkillName(name);
    if (!nameOk.ok) return Result.err(nameOk.error);
    const scopeKey = disabledScopeKeyOfProject(projectId);
    if (disabled) {
      await this.disabledRules.upsert(scopeKey, name);
    } else {
      await this.disabledRules.remove(scopeKey, name);
    }
    return Result.ok(undefined);
  }

  async deleteSkill(location: SkillLocation): Promise<Result<void, AppError>> {
    const nameOk = assertValidSkillName(location.name);
    if (!nameOk.ok) return Result.err(nameOk.error);
    // D2①：global 域内置名不可删（project 域历史同名副本仍可删）。
    if (location.domain === "global" && BUILTIN_SKILL_NAMES.has(location.name)) {
      return Result.err(new AppError("SKILL_BUILTIN", { descriptor: { key: "error.skill.builtin_not_deletable", params: { skill_name: location.name } }, skillName: location.name }));
    }
    // VFS 清理用 meta 域 key；负清单行的 scopeKey 仍是 project:{pid}，两者分开取
    const scopeKeyRes = vfsScopeKeyOfLocation(location);
    if (!scopeKeyRes.ok) return Result.err(scopeKeyRes.error);
    const vfsScopeKey = scopeKeyRes.value;
    const prefix = `${SKILLS_ROOT}/${location.name}`;

    // 存在性检查放事务外（避免错误被事务包装器包裹）。
    const dirOk = await this.assertSkillDirExists(new SqliteVfsEntryRepository(this.deps.conn), vfsScopeKey, prefix);
    if (!dirOk.ok) return Result.err(dirOk.error);

    await this.deps.conn.transaction(async (tx) => {
      const entryRepo = new SqliteVfsEntryRepository(tx);
      const revisionRepo = new SqliteVfsRevisionRepository(tx);
      await VfsTreeCopy.sweepRevisionsUnderScope(entryRepo, revisionRepo, vfsScopeKey, prefix);

      // 连带清理负清单行：project 域只清本项目行；global 域清所有项目行，
      // 否则会留下指向不存在技能的孤儿禁用行。
      const ruleRepo = new SqliteSkillDisabledRuleRepository(tx);
      if (location.domain === "project") {
        if (location.projectId == null || location.projectId.length === 0) {
          throw new AppError("SKILL_MISSING_PROJECT_ID", { descriptor: { key: "error.skill.missing_project_id", params: { skill_name: location.name } }, skillName: location.name });
        }
        await ruleRepo.remove(disabledScopeKeyOfProject(location.projectId), location.name);
      } else {
        await ruleRepo.removeAllScopesByName(location.name);
      }
    });

    // 事务提交后收被删技能整目录的 blob 残留：sweep 只把旧 blob 的 ref_count
    // 递减到 0 就停手（CS-06/CS-07 的守卫触发器要求「无 entry 引用」才删行），
    // vfs_entry 上零触发器补不了这一步 ⇒ 残留只能靠全库 gc。口径对齐另外 5 处
    // 删除链的既有约定：事务提交后调一次。
    await DeferredBlobGc.run(this.deps.conn);
    return Result.ok(undefined);
  }

  /**
   * 编辑技能信息（重命名 + 描述同一提交）：单事务（方案 A，deleteSkill
   * 同层先例）完成校验门 → 目录迁移 → front matter 同步 → 负清单迁移。
   *
   * 事务内的 VFS 操作用 tx 连接新建 scoped vfs（message-rollback 的嵌套
   * 先例）：vfs 内部 runInTransactionOrConn 对 TransactionalConnection 的
   * transaction 立即抛 NESTED_TRANSACTION 后复用 tx 直通，不经 mutex 排队
   * （若用捕获原 conn 的 deps 工厂，会与外层事务的 mutex 互等死锁）。
   *
   * 事务内抛的业务错误会被 driver 包装成 TdbcError(SQLITE_ERROR)，外层
   * 解包 cause 还原业务错误码（IPC 透传依赖）——解包后仍走 throw 通道
   * （事务回滚 + 包装是平台边界，D 类）。
   */
  async updateSkillInfo(location: SkillLocation, changes: SkillInfoChanges): Promise<Result<void, AppError>> {
    const { newName, description } = changes;
    if (newName == null && description == null) {
      return Result.ok(undefined); // 无变更提交，防御性 no-op
    }
    // 改名提交 = 提交了与现名不同的 newName；同值提交语义上是仅改描述
    const renaming = newName != null && newName !== location.name;

    // 校验链 1：技能名校验（仅提交 newName 时；同值提交校验无害）
    if (newName != null) {
      const nameOk = assertValidSkillName(newName);
      if (!nameOk.ok) return Result.err(nameOk.error);
    }
    // 校验链 2：内置源门（仅改名提交时）：global 域内置技能不可改名；
    // 仅改描述（含 newName 同值提交）放行，T-S2⑨ 防回归
    if (renaming && location.domain === "global" && BUILTIN_SKILL_NAMES.has(location.name)) {
      return Result.err(new AppError("SKILL_BUILTIN_RENAME", { descriptor: { key: "error.skill.builtin_rename_forbidden", params: { skill_name: location.name } }, skillName: location.name }));
    }
    // 校验链 3：目标保留名门（仅改名提交时）：目标名撞内置名且目标目录
    // 不存在（= 新建语义）拒；目录已存在（历史同名副本）由查重门接管
    if (renaming) {
      const reserved = await this.assertSkillNameNotReservedForCreate(location.domain, newName!, location.projectId);
      if (!reserved.ok) return Result.err(reserved.error);
    }

    // VFS 清理用 meta 域 key；project 域 projectId 校验同源
    const scopeKeyRes = vfsScopeKeyOfLocation(location);
    if (!scopeKeyRes.ok) return Result.err(scopeKeyRes.error);
    const vfsScopeKey = scopeKeyRes.value;
    const oldPrefix = `${SKILLS_ROOT}/${location.name}`;
    const newPrefix = renaming ? `${SKILLS_ROOT}/${newName}` : oldPrefix;

    // 存在性检查放事务外（deleteSkill 先例：避免错误被事务包装器包裹）
    const dirOk = await this.assertSkillDirExists(new SqliteVfsEntryRepository(this.deps.conn), vfsScopeKey, oldPrefix);
    if (!dirOk.ok) return Result.err(dirOk.error);

    try {
      await this.deps.conn.transaction(async (tx) => {
        const ruleRepo = new SqliteSkillDisabledRuleRepository(tx);
        // 校验链 4：域内查重（事务内重查，收口 TOCTOU；目标目录=自身时
        // 是同值提交，不算撞名）
        if (renaming) {
          const conflict = await this.skillDirExists(new SqliteVfsEntryRepository(tx), vfsScopeKey, newPrefix);
          if (conflict) {
            throw new AppError("SKILL_ALREADY_EXISTS", { descriptor: { key: "error.skill.already_exists", params: { skill_name: newName! } }, skillName: newName! });
          }
        }

        // 事务内用 tx 建 scoped vfs（嵌套先例见方法注释）
        const scope = location.domain === "global" ? { kind: "global-meta" as const } : { kind: "project-meta" as const, projectId: location.projectId! };
        const vfs = VfsServiceFactory.createScoped(tx, scope);

        // 校验链 5：目录迁移（entry_id / revision 历史自动跟随；
        // renamePrefix 无目标存在检查，由上一步事务内查重保证）
        if (renaming) {
          const renamed = await vfs.renamePrefix(oldPrefix, newPrefix);
          // 事务回调内失败必须 throw 才能回滚（unwrapOrRollback 集中解包，见 helper 注释）。
          unwrapOrRollback(renamed);
        }

        // 校验链 6：front matter 同步——解析成功才重写（bump version +
        // 写 revision）；invalid（含缺 SKILL.md）跳过，避免改名顺手
        // 「治好」无效技能的行为歧义
        const entryPath = `${newPrefix}/${SKILL_ENTRY_FILE}`;
        let source: string | null = null;
        const entryRead = await vfs.read(entryPath);
        if (entryRead.ok) {
          source = entryRead.value.content;
        } else if (!isAppError(entryRead.error, "VFS_NOT_FOUND")) {
          // 非 NOT_FOUND 的读取失败：抛出触发事务回滚（helper 集中解包）。
          unwrapOrRollback(entryRead);
        }
        if (source != null && parseSkillFrontMatter(source).valid) {
          const written = await vfs.write(entryPath, withSkillFrontMatterValues(source, { ...(newName != null ? { name: newName } : {}), ...(description != null ? { description } : {}) }));
          // 写失败必须回滚（renamePrefix 已迁移目录，吞错会留半写状态）。
          unwrapOrRollback(written);
        }

        // 校验链 7：负清单迁移（仅改名时）——project 域迁本项目单行；
        // global 域迁所有 scope 同名行（镜像 deleteSkill 连带口径）。
        // 已知边界（文档化不处理）：global X 与 project P 的 X 并存且
        // (P,X) 被禁用时改 global X 名，(P,X) 一并迁移但 P 实际生效的
        // 是本地副本 X，行成孤儿；低频组合接受。
        if (renaming) {
          if (location.domain === "project") {
            await ruleRepo.renameByName(disabledScopeKeyOfProject(location.projectId!), location.name, newName!);
          } else {
            await ruleRepo.renameByName(null, location.name, newName!);
          }
        }
      });
    } catch (error) {
      // 两 driver 的事务实现都会把非 TdbcError（含 AppError）包装成
      // SQLITE_ERROR（cause 保留原错）：解包还原业务错误码
      if (error instanceof TdbcError && isAppError(error.cause)) {
        throw error.cause;
      }
      throw error;
    }
    return Result.ok(undefined);
  }

  /**
   * 新建语义的内置保留名门（D2②，writeSkillFile 同源判定独立暴露）：
   *
   * 名单外直接放行；名单内且该域技能目录不存在（= 新建语义）返回
   * `Result.err(SKILL_BUILTIN_NAME_RESERVED)`（中文文案）；目录已存在
   * （编辑内置本体或历史副本）放行。ZIP 导入等不经 writeSkillFile 的
   * 新建通道，落盘前须先过这道门（CR D-1）。project 域须带 projectId
   * （缺失返回 `Result.err(SKILL_MISSING_PROJECT_ID)`）。
   */
  async assertSkillNameNotReservedForCreate(domain: SkillDomain, name: string, projectId?: string): Promise<Result<void, AppError>> {
    if (!BUILTIN_SKILL_NAMES.has(name)) {
      return Result.ok(undefined);
    }
    if (domain === "project" && (projectId == null || projectId.length === 0)) {
      return Result.err(new AppError("SKILL_MISSING_PROJECT_ID", { descriptor: { key: "error.skill.missing_project_id", params: { skill_name: name } }, skillName: name }));
    }
    const scopeKey = domain === "global" ? "global:meta" : `project:${projectId}:meta`;
    const dirExists = await this.skillDirExists(new SqliteVfsEntryRepository(this.deps.conn), scopeKey, `${SKILLS_ROOT}/${name}`);
    if (!dirExists) {
      return Result.err(new AppError("SKILL_BUILTIN_NAME_RESERVED", { descriptor: { key: "error.skill.builtin_name_reserved", params: { skill_name: name } }, skillName: name }));
    }
    return Result.ok(undefined);
  }

  /** 技能目录存在性判定（目录行或其下任一 entry 存在即视为存在）。 */
  private async skillDirExists(entryRepo: SqliteVfsEntryRepository, scopeKey: string, prefix: string): Promise<boolean> {
    const entries = await entryRepo.listEntriesUnderPrefix(scopeKey, prefix);
    return entries.some((entry) => entry.path === prefix || entry.path.startsWith(`${prefix}/`));
  }

  /** 技能目录不存在时返回 Err(SKILL_NOT_FOUND)（存在性判定与 writeSkillFile 新建拦截同源）。 */
  private async assertSkillDirExists(entryRepo: SqliteVfsEntryRepository, scopeKey: string, prefix: string): Promise<Result<void, AppError>> {
    if (!(await this.skillDirExists(entryRepo, scopeKey, prefix))) {
      return Result.err(new AppError("SKILL_NOT_FOUND", { detail: `Skill not found: ${prefix.slice(SKILLS_ROOT.length + 1)}`, skillName: prefix.slice(SKILLS_ROOT.length + 1) }));
    }
    return Result.ok(undefined);
  }
}
