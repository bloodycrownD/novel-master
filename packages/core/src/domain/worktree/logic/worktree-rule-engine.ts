/**
 * Worktree 规则视图引擎：单次 metadata + DFS，产出 enum 列表行与 displayByPath。
 *
 * @module domain/worktree/logic/worktree-rule-engine
 */

import {
  evaluateFileDisplay,
  sortDirPaths,
  sortFilesForDir,
  type WorktreeFileSortMeta,
} from "./worktree-eval.js";
import {
  directChildDirs,
  directChildFiles,
  parentDirOf,
} from "./worktree-tree.js";
import {
  isWorktreeRootPath,
  worktreeRootLogicalPath,
} from "./worktree-scope.js";
import type {
  DisplayState,
  InclusionMode,
  RuleState,
  WorktreeRuleRow,
  WorktreeScope,
} from "../model/worktree-types.js";
import type {
  WorktreeRuleContext,
  WorktreeRuleView,
} from "../model/worktree-rule-view.js";

/**
 * 评估工作树规则视图：纯规则 DFS，不算文件正文。
 */
export function evaluateWorktreeRuleView(
  scope: WorktreeScope,
  ctx: WorktreeRuleContext,
): WorktreeRuleView {
  const displayByPath = buildDisplayByPath(scope, ctx);
  const rows: WorktreeRuleRow[] = [];
  walkDir(scope, ctx, worktreeRootLogicalPath(scope), rows, displayByPath);
  return { rows, displayByPath };
}

/** 各文件 path → 展示档位（宏树后缀与列表 file 行共用）。 */
function buildDisplayByPath(
  scope: WorktreeScope,
  ctx: WorktreeRuleContext,
): Map<string, DisplayState> {
  const displayByPath = new Map<string, DisplayState>();
  for (const filePath of ctx.fileSet) {
    const parent = parentDirOf(filePath);
    if (parent == null) {
      continue;
    }
    displayByPath.set(
      filePath,
      computeDisplay(scope, ctx, filePath, parent),
    );
  }
  return displayByPath;
}

function resolveRuleState(
  scope: WorktreeScope,
  dirPath: string,
  ctx: WorktreeRuleContext,
): RuleState {
  if (isWorktreeRootPath(scope, dirPath)) {
    return "rule_on";
  }
  const rule = ctx.dirRuleMap.get(dirPath);
  if (rule == null || !rule.ruleEnabled) {
    return "rule_off";
  }
  return "rule_on";
}

function resolveInclusion(
  filePath: string,
  ctx: WorktreeRuleContext,
): InclusionMode {
  return ctx.fileRuleMap.get(filePath)?.inclusionMode ?? "auto";
}

function computeDisplay(
  scope: WorktreeScope,
  ctx: WorktreeRuleContext,
  filePath: string,
  parentDir: string,
): DisplayState {
  const inclusion = resolveInclusion(filePath, ctx);
  const parentRuleOn =
    resolveRuleState(scope, parentDir, ctx) === "rule_on";
  const dirRule = ctx.dirRuleMap.get(parentDir) ?? null;
  const siblings = directChildFiles(parentDir, ctx.fileSet);
  const autoSiblings: WorktreeFileSortMeta[] = siblings
    .filter((p) => resolveInclusion(p, ctx) === "auto")
    .map((p) => ({
      logicalPath: p,
      mtimeMs: ctx.mtimeByPath.get(p) ?? 0,
    }));
  const sortedAuto = sortFilesForDir(autoSiblings, dirRule);
  const index = sortedAuto.findIndex((f) => f.logicalPath === filePath);
  return evaluateFileDisplay({
    inclusion,
    parentRuleOn,
    dirRule,
    indexInSortedAutoFiles: index < 0 ? 0 : index,
    autoFileCount: sortedAuto.length,
    logicalPath: filePath,
  });
}

function walkDir(
  scope: WorktreeScope,
  ctx: WorktreeRuleContext,
  dirPath: string,
  rows: WorktreeRuleRow[],
  displayByPath: ReadonlyMap<string, DisplayState>,
): void {
  rows.push({
    kind: "dir",
    path: dirPath,
    ruleState: resolveRuleState(scope, dirPath, ctx),
  });

  const dirRule = ctx.dirRuleMap.get(dirPath) ?? null;

  const subdirs = sortDirPaths(directChildDirs(dirPath, ctx.allDirs), dirRule);
  for (const sub of subdirs) {
    walkDir(scope, ctx, sub, rows, displayByPath);
  }

  const files = directChildFiles(dirPath, ctx.fileSet);
  const sortedFiles = sortFilesForDir(
    files.map((p) => ({
      logicalPath: p,
      mtimeMs: ctx.mtimeByPath.get(p) ?? 0,
    })),
    dirRule,
  ).map((f) => f.logicalPath);

  for (const filePath of sortedFiles) {
    rows.push({
      kind: "file",
      path: filePath,
      inclusionMode: resolveInclusion(filePath, ctx),
      displayState: displayByPath.get(filePath) ?? "hidden",
    });
  }
}
