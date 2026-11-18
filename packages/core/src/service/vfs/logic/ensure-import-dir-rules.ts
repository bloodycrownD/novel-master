/**
 * 导入链路的目录规则补行 helper。
 *
 * 导入（角色卡 / ZIP）产生的所有新增目录（含任意深度嵌套）默认开启目录规则，
 * 由本 helper 在导入事务内、文件全部写入之后统一保证：取导入目标前缀下的
 * 全部目录，与 workplace 规则表已有行求差，对无行目录补一条默认启用规则行。
 *
 * 错误口径：逐目录 try/catch + `console.warn`（单个目录补行失败只跳过该目录，
 * 不阻断剩余目录补行，见 PRD 需求 4），外层再包整体 try/catch 兜底 warn
 * （对齐 clear-session-prompt-caches 的 best-effort 口径——文件已落库，补行
 * 失败不应让导入报错）。差异须注意：它在事务提交后吞错，本 helper 在事务**内**
 * 吞错，依赖 SQLite 语句级失败不自动 ROLLBACK、后续语句可继续提交的行为
 * （由 T-I5 故障注入用例守卫）。
 *
 * @module service/vfs/logic/ensure-import-dir-rules
 */

import { LogicalPath, type VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { PathNormalizer } from "@/domain/vfs/repositories/impl/normalize-path.js";
import type { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { DEFAULT_WORKPLACE_DIR_RULE } from "@/domain/workplace/logic/default-dir-rule.js";
import { workplaceScopeKey } from "@/domain/workplace/logic/workplace-scope.js";
import type { WorkplaceDirRule } from "@/domain/workplace/model/workplace-types.js";
import type { WorkplaceRepository } from "@/domain/workplace/repositories/workplace.port.js";
import { createLogger } from "@/infra/log/logger.js";

const log = createLogger("vfs.import-dir-rules");

/**
 * 构造「默认启用」目录规则行。
 *
 * 必须与 `WorkplaceService.setDirRule({ logicalPath })` 在无既有行时的产物
 * 逐字段等价（含路径规范化与 scopeKey），等价性由单测锁定。
 *
 * nm-style: keep-local — 默认规则行构造契约（等价性注记）由单测 3 处直接构造期望行，
 * 内联会丢注记且须改测试。
 * 错误通道迁移四期：PathNormalizer.normalize 失败走返回值通道（输入来自已入库路径），决定权交给上层。
 */
export function buildDefaultDirRule(scopeKey: string, logicalPath: string): Result<WorkplaceDirRule, AppError> {
  const normalized = PathNormalizer.normalize(logicalPath);
  if (!normalized.ok) return Result.err(normalized.error);
  return Result.ok({
    scopeKey,
    logicalPath: normalized.value,
    ruleEnabled: true,
    sortField: DEFAULT_WORKPLACE_DIR_RULE.sortField,
    sortOrder: DEFAULT_WORKPLACE_DIR_RULE.sortOrder,
    headCount: DEFAULT_WORKPLACE_DIR_RULE.headCount,
    tailCount: DEFAULT_WORKPLACE_DIR_RULE.tailCount,
    fillPolicy: DEFAULT_WORKPLACE_DIR_RULE.fillPolicy,
  });
}

type WriteDefaultDirRule = (logicalPath: string) => Promise<Result<void, AppError>>;

/**
 * 求差补行内核：候选目录中无既有行的（跳过根 `/`）逐个补默认启用行。
 *
 * 写入载体由调用方注入（导入侧走 repo `upsertDirRule` 直构行，工具侧走
 * service `setDirRule`），求差 / 跳根 / 路径规范化逻辑在此共享。
 *
 * @param candidates 候选目录逻辑路径集合
 * @param existing 已有规则行的逻辑路径集合（有行即跳过，含 rule_off 不覆盖）
 * @param writeDefaultRule 写入一条默认启用行的载体；Err 即中断补行并原样接力
 */
export async function backfillMissingDirRules(candidates: readonly string[], existing: ReadonlySet<string>, writeDefaultRule: WriteDefaultDirRule): Promise<Result<void, AppError>> {
  for (const candidate of candidates) {
    const normalized = PathNormalizer.normalize(candidate);
    if (!normalized.ok) return Result.err(normalized.error);
    const logicalPath = normalized.value;
    if (logicalPath === "/" || existing.has(logicalPath)) {
      continue;
    }
    const written = await writeDefaultRule(logicalPath);
    if (!written.ok) return Result.err(written.error);
  }
  return Result.ok(undefined);
}

/** {@link ensureImportDirRules} 依赖。 */
interface EnsureImportDirRulesDeps {
  /** 事务级 VFS repo（用于查导入前缀下的目录全集）。 */
  readonly vfsRepo: VfsEntryRepository;
  /** 事务级 workplace repo（用于读已有行 / 补默认行）。 */
  readonly workplaceRepo: WorkplaceRepository;
  /** 导入目标 scope。 */
  readonly scope: VfsScope;
  /** 导入目标目录（前缀，含自身）。 */
  readonly directoryPath: string;
}

/**
 * 导入事务内补目录规则默认行。
 *
 * scope 键空间必须分开算：查 VFS 表用 vfs 的 `scopeKey`，读写 workplace 表用
 * `workplaceScopeKey`——两者是不同键空间（session 分别为
 * `session:${projectId}:${sessionId}` 与 `session:${sessionId}`），严禁混用。
 * 目录全集含 prefix 自身；根自身 `/` 由内核跳过不补，根前缀（`/`）下其余
 * 子目录照常求差补行（CLI / desktop 缺省导入到根的场景由此覆盖）。
 */
export async function ensureImportDirRules(deps: EnsureImportDirRulesDeps): Promise<void> {
  const { vfsRepo, workplaceRepo, scope, directoryPath } = deps;
  try {
    const normalizedPrefix = PathNormalizer.normalize(directoryPath);
    if (!normalizedPrefix.ok) {
      log.warn(`best-effort 补目录规则行失败（directory=${directoryPath}）`, { error: normalizedPrefix.error });
      return;
    }
    const prefix = normalizedPrefix.value;
    const targetScopeKey = workplaceScopeKey(scope);
    const directories = await vfsRepo.listDirectoryPathsUnderPrefix(LogicalPath.scopeKey(scope), prefix);
    const existing = new Set<string>();
    for (const rule of await workplaceRepo.listDirRules(targetScopeKey)) {
      const normalized = PathNormalizer.normalize(rule.logicalPath);
      if (!normalized.ok) {
        log.warn(`best-effort 补目录规则行失败（directory=${directoryPath}）`, { error: normalized.error });
        return;
      }
      existing.add(normalized.value);
    }
    const writeDefaultRule = async (logicalPath: string): Promise<Result<void, AppError>> => {
      const rule = buildDefaultDirRule(targetScopeKey, logicalPath);
      if (!rule.ok) {
        // 逐目录容错（PRD 需求 4）：单个目录补行失败只 warn 并跳过，
        // 不阻断剩余目录补行；外层整体 try/catch 仍是兜底。
        log.warn(`补目录规则行失败（directory=${logicalPath}）`, { error: rule.error });
        return Result.ok(undefined);
      }
      try {
        await workplaceRepo.upsertDirRule(rule.value);
      } catch (error) {
        log.warn(`补目录规则行失败（directory=${logicalPath}）`, { error });
      }
      return Result.ok(undefined);
    };
    const backfilled = await backfillMissingDirRules(directories, existing, writeDefaultRule);
    if (!backfilled.ok) {
      log.warn(`best-effort 补目录规则行失败（directory=${directoryPath}）`, { error: backfilled.error });
    }
  } catch (error) {
    // 吞错但不无声：目录/文件已落库（同事务），补规则失败不阻断导入主流程。
    log.warn(`best-effort 补目录规则行失败（directory=${directoryPath}）`, { error });
  }
}
