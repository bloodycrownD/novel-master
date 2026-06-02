/**
 * Worktree rule toggles for VFS file manager row actions.
 */
import type {
  InclusionMode,
  SetDirRuleInput,
  VfsScope,
  WorktreeDirRule,
  WorktreeService,
} from '@novel-master/core';
import { DEFAULT_WORKTREE_DIR_RULE } from '@novel-master/core';

function worktreeRootLogicalPath(_scope: VfsScope): string {
  return '/';
}

function isWorktreeRootPath(scope: VfsScope, logicalPath: string): boolean {
  return logicalPath === worktreeRootLogicalPath(scope);
}

const INCLUSION_CYCLE: InclusionMode[] = ['auto', 'show', 'hide'];

/** Parse Chinese inclusion label from {@link WorktreeListRow}. */
export function inclusionLabelToMode(label: string): InclusionMode {
  switch (label) {
    case '展示':
      return 'show';
    case '隐藏':
      return 'hide';
    default:
      return 'auto';
  }
}

/** Cycle file inclusion auto → show → hide. */
export async function cycleFileInclusion(
  worktree: WorktreeService,
  logicalPath: string,
  currentLabel: string,
): Promise<InclusionMode> {
  const current = inclusionLabelToMode(currentLabel);
  const next =
    INCLUSION_CYCLE[(INCLUSION_CYCLE.indexOf(current) + 1) % INCLUSION_CYCLE.length];
  await worktree.setFileRule({logicalPath, inclusionMode: next});
  return next;
}

/** Toggle directory rule on/off; root directory cannot be disabled. */
export async function toggleDirRuleEnabled(
  worktree: WorktreeService,
  logicalPath: string,
  currentlyEnabled: boolean,
): Promise<boolean> {
  if (currentlyEnabled && isWorktreeRootPath(worktree.scope, logicalPath)) {
    throw new Error('根目录规则不可关闭');
  }
  const nextEnabled = !currentlyEnabled;
  await worktree.setDirRule({
    logicalPath,
    ruleEnabled: nextEnabled,
  });
  return nextEnabled;
}

/** Map persisted directory rule to sheet form input. */
export function dirRuleToForm(rule: WorktreeDirRule): SetDirRuleInput {
  return {
    logicalPath: rule.logicalPath,
    sortField: rule.sortField,
    sortOrder: rule.sortOrder,
    headCount: rule.headCount,
    tailCount: rule.tailCount,
    fillPolicy: rule.fillPolicy,
    ruleEnabled: rule.ruleEnabled,
  };
}

/** Default form values for directory rule sheet (Core merge semantics). */
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
        inclusionMode: inclusionLabelToMode(row.inclusionMode),
      });
    }
  }
}
