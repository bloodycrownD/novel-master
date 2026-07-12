/**
 * Worktree rule toggles for VFS file manager row actions.
 */
import { type VfsScope } from "@novel-master/core/vfs";

import { type InclusionMode, type SetDirRuleInput, type WorktreeDirRule, type WorktreeService } from "@novel-master/core/worktree";
import { DEFAULT_WORKTREE_DIR_RULE } from "@novel-master/core/worktree";
import { normalizeFillPolicyForMobile } from '../storage/fill-policy-mobile';

function worktreeRootLogicalPath(_scope: VfsScope): string {
  return '/';
}

function isWorktreeRootPath(scope: VfsScope, logicalPath: string): boolean {
  return logicalPath === worktreeRootLogicalPath(scope);
}

const INCLUSION_CYCLE: InclusionMode[] = ['auto', 'show', 'hide'];

/** Cycle file inclusion auto → show → hide. */
export async function cycleFileInclusion(
  worktree: WorktreeService,
  logicalPath: string,
  currentMode: InclusionMode,
): Promise<InclusionMode> {
  const next =
    INCLUSION_CYCLE[(INCLUSION_CYCLE.indexOf(currentMode) + 1) % INCLUSION_CYCLE.length];
  await worktree.setFileRule({logicalPath, inclusionMode: next});
  return next;
}

/** Set directory rule enabled; root cannot be disabled. */
export async function setDirRuleEnabled(
  worktree: WorktreeService,
  logicalPath: string,
  enabled: boolean,
): Promise<void> {
  if (!enabled && isWorktreeRootPath(worktree.scope, logicalPath)) {
    throw new Error('根目录规则不可关闭');
  }
  await worktree.setDirRule({
    logicalPath,
    ruleEnabled: enabled,
  });
}

/** Toggle directory rule on/off; root directory cannot be disabled. */
export async function toggleDirRuleEnabled(
  worktree: WorktreeService,
  logicalPath: string,
  currentlyEnabled: boolean,
): Promise<boolean> {
  const nextEnabled = !currentlyEnabled;
  await setDirRuleEnabled(worktree, logicalPath, nextEnabled);
  return nextEnabled;
}

/**
 * Batch enable/disable rules on selected directory rows; skips files and root when disabling.
 */
export async function batchSetDirRulesEnabled(
  worktree: WorktreeService,
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
      await setDirRuleEnabled(worktree, path, true);
      applied += 1;
    } catch {
      skipped += 1;
    }
  }
  return {applied, skipped};
}

export async function batchSetDirRulesDisabled(
  worktree: WorktreeService,
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
      await setDirRuleEnabled(worktree, path, false);
      applied += 1;
    } catch {
      skipped += 1;
    }
  }
  return {applied, skipped};
}

/** Map persisted directory rule to sheet form input. */
export function dirRuleToForm(rule: WorktreeDirRule): SetDirRuleInput {
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
    sortField: DEFAULT_WORKTREE_DIR_RULE.sortField,
    sortOrder: DEFAULT_WORKTREE_DIR_RULE.sortOrder,
    headCount: DEFAULT_WORKTREE_DIR_RULE.headCount,
    tailCount: DEFAULT_WORKTREE_DIR_RULE.tailCount,
    fillPolicy: DEFAULT_WORKTREE_DIR_RULE.fillPolicy,
    ruleEnabled: true,
  };
}

/** 无持久化规则记录时弹窗展示的表单初值（规则关闭，其余字段同 Core 默认）。 */
export function emptyDirRuleForm(logicalPath: string) {
  return {
    logicalPath,
    sortField: DEFAULT_WORKTREE_DIR_RULE.sortField,
    sortOrder: DEFAULT_WORKTREE_DIR_RULE.sortOrder,
    headCount: DEFAULT_WORKTREE_DIR_RULE.headCount,
    tailCount: DEFAULT_WORKTREE_DIR_RULE.tailCount,
    fillPolicy: DEFAULT_WORKTREE_DIR_RULE.fillPolicy,
    ruleEnabled: false,
  };
}

/** Scope root path for navigation (unified logical `/` for all domains). */
export function vfsScopeRootPath(
  scope: WorktreeService['scope'],
): string {
  return worktreeRootLogicalPath(scope);
}

function pathUnderDir(dirPath: string, candidate: string): boolean {
  return candidate === dirPath || candidate.startsWith(`${dirPath}/`);
}

/**
 * Copy worktree dir/file rules from oldDir prefix onto newDir after a VFS rename.
 * Old rule rows may remain until Core exposes delete; new paths get matching rules.
 */
export async function migrateWorktreeDirRename(
  worktree: WorktreeService,
  oldDir: string,
  newDir: string,
): Promise<void> {
  const rows = await worktree.buildListRows();
  for (const row of rows) {
    if (!pathUnderDir(oldDir, row.path)) {
      continue;
    }
    const targetPath =
      row.path === oldDir
        ? newDir
        : `${newDir}${row.path.slice(oldDir.length)}`;
    if (row.kind === 'dir') {
      const rule = await worktree.getDirRule(row.path);
      if (rule != null) {
        await worktree.setDirRule({...dirRuleToForm(rule), logicalPath: targetPath});
      }
    } else {
      await worktree.setFileRule({
        logicalPath: targetPath,
        inclusionMode: row.inclusionMode,
      });
    }
  }
}
