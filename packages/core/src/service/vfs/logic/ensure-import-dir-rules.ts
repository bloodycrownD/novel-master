/**
 * 导入链路的目录规则补行 helper。
 *
 * 导入（角色卡 / ZIP）产生的所有新增目录（含任意深度嵌套）默认开启目录规则，
 * 由本 helper 在导入事务内、文件全部写入之后统一保证：取导入目标前缀下的
 * 全部目录，与 workplace 规则表已有行求差，对无行目录补一条默认启用规则行。
 *
 * 错误口径：整体 try/catch 吞错 + `console.warn`（对齐 clear-session-prompt-caches
 * 的 best-effort 口径——文件已落库，补行失败不应让导入报错）。差异须注意：它
 * 在事务提交后吞错，本 helper 在事务**内**吞错，依赖 SQLite 语句级失败不自动
 * ROLLBACK、后续语句可继续提交的行为（由 T-I5 故障注入用例守卫）。
 *
 * @module service/vfs/logic/ensure-import-dir-rules
 */

import { scopeKey, type VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { DEFAULT_WORKPLACE_DIR_RULE } from "@/domain/workplace/logic/default-dir-rule.js";
import { workplaceScopeKey } from "@/domain/workplace/logic/workplace-scope.js";
import type {
  WorkplaceDirRule,
  WorkplaceScope,
} from "@/domain/workplace/model/workplace-types.js";
import type { WorkplaceRepository } from "@/domain/workplace/repositories/workplace.port.js";

/**
 * 构造「默认启用」目录规则行。
 *
 * 必须与 `WorkplaceService.setDirRule({ logicalPath })` 在无既有行时的产物
 * 逐字段等价（含路径规范化与 scopeKey），等价性由单测锁定。
 */
export function buildDefaultDirRule(
  scopeKey: string,
  logicalPath: string
): WorkplaceDirRule {
  return {
    scopeKey,
    logicalPath: normalizePath(logicalPath),
    ruleEnabled: true,
    sortField: DEFAULT_WORKPLACE_DIR_RULE.sortField,
    sortOrder: DEFAULT_WORKPLACE_DIR_RULE.sortOrder,
    headCount: DEFAULT_WORKPLACE_DIR_RULE.headCount,
    tailCount: DEFAULT_WORKPLACE_DIR_RULE.tailCount,
    fillPolicy: DEFAULT_WORKPLACE_DIR_RULE.fillPolicy,
  };
}

/**
 * 求差补行内核：候选目录中无既有行的（跳过根 `/`）逐个补默认启用行。
 *
 * 写入载体由调用方注入（导入侧走 repo `upsertDirRule` 直构行，工具侧走
 * service `setDirRule`），求差 / 跳根 / 路径规范化逻辑在此共享。
 *
 * @param candidates 候选目录逻辑路径集合
 * @param existingLogicalPaths 已有规则行的逻辑路径集合（有行即跳过，含 rule_off 不覆盖）
 * @param writeDefaultRule 写入一条默认启用行的载体
 */
export async function backfillMissingDirRules(
  candidates: readonly string[],
  existingLogicalPaths: ReadonlySet<string>,
  writeDefaultRule: (logicalPath: string) => Promise<void>
): Promise<void> {
  for (const candidate of candidates) {
    const logicalPath = normalizePath(candidate);
    if (logicalPath === "/" || existingLogicalPaths.has(logicalPath)) {
      continue;
    }
    await writeDefaultRule(logicalPath);
  }
}

/** {@link ensureImportDirRules} 依赖。 */
export interface EnsureImportDirRulesDeps {
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
export async function ensureImportDirRules(
  deps: EnsureImportDirRulesDeps
): Promise<void> {
  const { vfsRepo, workplaceRepo, scope, directoryPath } = deps;
  try {
    const prefix = normalizePath(directoryPath);
    const targetScopeKey = workplaceScopeKey(scope as unknown as WorkplaceScope);
    const directories = await vfsRepo.listDirectoryPathsUnderPrefix(
      scopeKey(scope),
      prefix
    );
    const existing = new Set(
      (await workplaceRepo.listDirRules(targetScopeKey)).map((rule) =>
        normalizePath(rule.logicalPath)
      )
    );
    await backfillMissingDirRules(
      directories,
      existing,
      (logicalPath) =>
        workplaceRepo.upsertDirRule(
          buildDefaultDirRule(targetScopeKey, logicalPath)
        )
    );
  } catch (error) {
    // 吞错但不无声：目录/文件已落库（同事务），补规则失败不阻断导入主流程。
    console.warn(
      `ensureImportDirRules: best-effort 补目录规则行失败（directory=${directoryPath}）`,
      error
    );
  }
}
