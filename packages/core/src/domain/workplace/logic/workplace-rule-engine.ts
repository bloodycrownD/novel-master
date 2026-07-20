/**
 * Workplace 规则视图引擎：单次 metadata + DFS，产出 enum 列表行与 displayByPath。
 *
 * @module domain/workplace/logic/workplace-rule-engine
 */

import {
  evaluateFileDisplay,
  sortDirPaths,
  sortFilesForDir,
  type WorkplaceFileSortMeta,
} from "./workplace-eval.js";
import {
  directChildDirs,
  directChildFiles,
  parentDirOf,
} from "./workplace-tree.js";
import {
  isWorkplaceRootPath,
  workplaceRootLogicalPath,
} from "./workplace-scope.js";
import type {
  DisplayState,
  InclusionMode,
  RuleState,
  WorkplaceRuleRow,
  WorkplaceScope,
} from "../model/workplace-types.js";
import type {
  WorkplaceRuleContext,
  WorkplaceRuleView,
} from "../model/workplace-rule-view.js";

/**
 * 评估工作区规则视图：纯规则 DFS，不算文件正文。
 */
export function evaluateWorkplaceRuleView(
  scope: WorkplaceScope,
  ctx: WorkplaceRuleContext,
): WorkplaceRuleView {
  const displayByPath = buildDisplayByPath(scope, ctx);
  const rows: WorkplaceRuleRow[] = [];
  walkDir(scope, ctx, workplaceRootLogicalPath(scope), rows, displayByPath);
  return { rows, displayByPath };
}

/** 各文件 path → 展示档位（宏树后缀与列表 file 行共用）。 */
function buildDisplayByPath(
  scope: WorkplaceScope,
  ctx: WorkplaceRuleContext,
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
  scope: WorkplaceScope,
  dirPath: string,
  ctx: WorkplaceRuleContext,
): RuleState {
  if (isWorkplaceRootPath(scope, dirPath)) {
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
  ctx: WorkplaceRuleContext,
): InclusionMode {
  return ctx.fileRuleMap.get(filePath)?.inclusionMode ?? "auto";
}

function computeDisplay(
  scope: WorkplaceScope,
  ctx: WorkplaceRuleContext,
  filePath: string,
  parentDir: string,
): DisplayState {
  const inclusion = resolveInclusion(filePath, ctx);
  const parentRuleOn =
    resolveRuleState(scope, parentDir, ctx) === "rule_on";
  const dirRule = ctx.dirRuleMap.get(parentDir) ?? null;
  const siblings = directChildFiles(parentDir, ctx.fileSet);
  const autoSiblings: WorkplaceFileSortMeta[] = siblings
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
  scope: WorkplaceScope,
  ctx: WorkplaceRuleContext,
  dirPath: string,
  rows: WorkplaceRuleRow[],
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
