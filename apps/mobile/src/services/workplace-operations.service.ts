/**
 * Workplace rule toggles for VFS file manager row actions.
 */
import {type VfsScope} from '@novel-master/core/vfs';

import {
  type InclusionMode,
  type SetDirRuleInput,
  type WorkplaceDirRule,
  type WorkplaceService,
} from '@novel-master/core/workplace';
import {DEFAULT_WORKPLACE_DIR_RULE} from '@novel-master/core/workplace';
import {normalizeFillPolicyForMobile} from '@/storage/fill-policy-mobile';

function workplaceRootLogicalPath(_scope: VfsScope): string {
  return '/';
}

function isWorkplaceRootPath(scope: VfsScope, logicalPath: string): boolean {
  return logicalPath === workplaceRootLogicalPath(scope);
}

const INCLUSION_CYCLE: InclusionMode[] = ['auto', 'show', 'hide'];

/** Cycle file inclusion auto → show → hide. */
export async function cycleFileInclusion(
  workplace: WorkplaceService,
  logicalPath: string,
  currentMode: InclusionMode,
): Promise<InclusionMode> {
  const next =
    INCLUSION_CYCLE[
      (INCLUSION_CYCLE.indexOf(currentMode) + 1) % INCLUSION_CYCLE.length
    ];
  await workplace.setFileRule({logicalPath, inclusionMode: next});
  return next;
}

/** Set directory rule enabled; root cannot be disabled. */
export async function setDirRuleEnabled(
  workplace: WorkplaceService,
  logicalPath: string,
  enabled: boolean,
): Promise<void> {
  if (!enabled && isWorkplaceRootPath(workplace.scope, logicalPath)) {
    throw new Error('根目录规则不可关闭');
  }
  await workplace.setDirRule({
    logicalPath,
    ruleEnabled: enabled,
  });
}

/** Toggle directory rule on/off; root directory cannot be disabled. */
export async function toggleDirRuleEnabled(
  workplace: WorkplaceService,
  logicalPath: string,
  currentlyEnabled: boolean,
): Promise<boolean> {
  const nextEnabled = !currentlyEnabled;
  await setDirRuleEnabled(workplace, logicalPath, nextEnabled);
  return nextEnabled;
}

/**
 * Batch enable/disable rules on selected directory rows; skips files and root when disabling.
 */
export async function batchSetDirRulesEnabled(
  workplace: WorkplaceService,
  paths: readonly string[],
  dirPaths: ReadonlySet<string>,
): Promise<{applied: number; skipped: number}> {
  let applied = 0;
  let skipped = 0;
  for (const path of paths) {
    if (!dirPaths.has(path)) {
      skipped += 1;
      continue;
    }
    try {
      await setDirRuleEnabled(workplace, path, true);
      applied += 1;
    } catch {
      skipped += 1;
    }
  }
  return {applied, skipped};
}

export async function batchSetDirRulesDisabled(
  workplace: WorkplaceService,
  paths: readonly string[],
  dirPaths: ReadonlySet<string>,
): Promise<{applied: number; skipped: number}> {
  let applied = 0;
  let skipped = 0;
  for (const path of paths) {
    if (!dirPaths.has(path)) {
      skipped += 1;
      continue;
    }
    try {
      await setDirRuleEnabled(workplace, path, false);
      applied += 1;
    } catch {
      skipped += 1;
    }
  }
  return {applied, skipped};
}

/** Map persisted directory rule to sheet form input. */
export function dirRuleToForm(rule: WorkplaceDirRule): SetDirRuleInput {
  return {
    logicalPath: rule.logicalPath,
    sortField: rule.sortField,
    sortOrder: rule.sortOrder,
    headCount: rule.headCount,
    tailCount: rule.tailCount,
    fillPolicy: normalizeFillPolicyForMobile(rule.fillPolicy),
    ruleEnabled: rule.ruleEnabled,
  };
}

/** Default form values for new directory creation (Core merge semantics). */
export function defaultDirRuleForm(logicalPath: string) {
  return {
    logicalPath,
    sortField: DEFAULT_WORKPLACE_DIR_RULE.sortField,
    sortOrder: DEFAULT_WORKPLACE_DIR_RULE.sortOrder,
    headCount: DEFAULT_WORKPLACE_DIR_RULE.headCount,
    tailCount: DEFAULT_WORKPLACE_DIR_RULE.tailCount,
    fillPolicy: DEFAULT_WORKPLACE_DIR_RULE.fillPolicy,
    ruleEnabled: true,
  };
}

/** 无持久化规则记录时弹窗展示的表单初值（规则关闭，其余字段同 Core 默认）。 */
export function emptyDirRuleForm(logicalPath: string) {
  return {
    logicalPath,
    sortField: DEFAULT_WORKPLACE_DIR_RULE.sortField,
    sortOrder: DEFAULT_WORKPLACE_DIR_RULE.sortOrder,
    headCount: DEFAULT_WORKPLACE_DIR_RULE.headCount,
    tailCount: DEFAULT_WORKPLACE_DIR_RULE.tailCount,
    fillPolicy: DEFAULT_WORKPLACE_DIR_RULE.fillPolicy,
    ruleEnabled: false,
  };
}

/** Scope root path for navigation (unified logical `/` for all domains). */
export function vfsScopeRootPath(scope: WorkplaceService['scope']): string {
  return workplaceRootLogicalPath(scope);
}

function pathUnderDir(dirPath: string, candidate: string): boolean {
  return candidate === dirPath || candidate.startsWith(`${dirPath}/`);
}

/**
 * Copy workplace dir/file rules from oldDir prefix onto newDir after a VFS rename.
 * Old rule rows may remain until Core exposes delete; new paths get matching rules.
 */
export async function migrateWorkplaceDirRename(
  workplace: WorkplaceService,
  oldDir: string,
  newDir: string,
): Promise<void> {
  // 一条 SQL UPDATE 批量重命名规则路径，替代逐条 get+set 循环。
  // 旧实现 70 文件目录要 ~1s（每个文件单独 getDirRule + setDirRule）；
  // 批量 UPDATE 只需几 ms，且不会残留旧路径规则（rename 而非 copy）。
  //
  // 语义确认：buildListRows 会枚举 scope 下每个 VFS 文件（不只 file_rule 已存在的行），
  // 旧逻辑的 file 分支对每个文件都 setFileRule（UPSERT），包括原本没有规则行的文件——
  // 会给它们写入 inclusionMode=auto 的冗余行。新逻辑是纯 UPDATE，只迁移真实规则行；
  // 对未配置规则的文件不产生新行，展示行为与 auto 完全等价（auto 就是默认），
  // 反而避免了残留冗余的 auto 规则行，因此 UPDATE 是更干净且行为等价的做法。
  await workplace.renameRulesUnderLogicalPrefix(oldDir, newDir);
}
