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

function worktreeRootLogicalPath(scope: VfsScope): string {
  return scope.kind === 'session' ? '/' : '/template';
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
    sortField: 'name' as const,
    sortOrder: 'asc' as const,
    headCount: 0,
    tailCount: 0,
    fillPolicy: 'hidden' as const,
    ruleEnabled: true,
  };
}

/** Scope root path for navigation (session `/`, template scopes `/template`). */
export function vfsScopeRootPath(
  scope: WorktreeService['scope'],
): string {
  return worktreeRootLogicalPath(scope);
}
