/**
 * Workplace 规则视图引擎：单次 metadata + DFS，产出 enum 列表行与 displayByPath。
 *
 * 性能约定（huge-card-import-crash 修复）：每个目录的文件只排序**一次**，
 * 排名与计数落到 Map 供 O(1) 查询——旧实现对每个文件重新排序其全部兄弟
 * （O(N²·logN) 智能比较），556 文件的工作区在真机上一次评估要分钟级并把
 * JS 线程占死；现在单次评估 O(N·logN)，行为与旧实现完全一致。
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

/** 每个目录一次性的排序产物：auto 排名 + 完整子文件序列。 */
interface DirSortPlan {
  /** auto 纳入文件在排序后的名次（0 起）；非 auto 文件不在表中。 */
  readonly autoIndexByFile: ReadonlyMap<string, number>;
  /** auto 纳入文件总数（旧实现 `sortedAuto.length` 语义）。 */
  readonly autoCount: number;
  /** 排序后的全部直接子文件（列表行顺序，walkDir 用）。 */
  readonly sortedFiles: readonly string[];
}

/**
 * 评估工作区规则视图：纯规则 DFS，不算文件正文。
 */
export function evaluateWorkplaceRuleView(
  scope: WorkplaceScope,
  ctx: WorkplaceRuleContext
): WorkplaceRuleView {
  const planByDir = buildDirSortPlans(ctx);
  const displayByPath = buildDisplayByPath(scope, ctx, planByDir);
  const rows: WorkplaceRuleRow[] = [];
  walkDir(
    scope,
    ctx,
    workplaceRootLogicalPath(scope),
    rows,
    displayByPath,
    planByDir
  );
  return { rows, displayByPath };
}

/**
 * 一次遍历按父目录分组，每个目录只排序两次（auto 名单 / 全量名单），
 * 名次与序列缓存在 Map 中——排序成本从 O(N²·logN) 降为 O(N·logN)。
 */
function buildDirSortPlans(ctx: WorkplaceRuleContext): Map<string, DirSortPlan> {
  const filesByDir = new Map<string, string[]>();
  for (const filePath of ctx.fileSet) {
    const parent = parentDirOf(filePath);
    if (parent == null) {
      continue;
    }
    const bucket = filesByDir.get(parent);
    if (bucket != null) {
      bucket.push(filePath);
    } else {
      filesByDir.set(parent, [filePath]);
    }
  }

  const metaOf = (p: string): WorkplaceFileSortMeta => ({
    logicalPath: p,
    mtimeMs: ctx.mtimeByPath.get(p) ?? 0,
  });

  const plans = new Map<string, DirSortPlan>();
  for (const [dir, files] of filesByDir) {
    const dirRule = ctx.dirRuleMap.get(dir) ?? null;
    const autoIndexByFile = new Map<string, number>();
    let autoCount = 0;
    // auto 名单单独排序：名次与总数（旧 computeDisplay 的 sortedAuto 语义）
    const autoMetas: WorkplaceFileSortMeta[] = [];
    for (const p of files) {
      if (resolveInclusion(p, ctx) === "auto") {
        autoMetas.push(metaOf(p));
      }
    }
    const sortedAuto = sortFilesForDir(autoMetas, dirRule);
    autoCount = sortedAuto.length;
    for (let i = 0; i < sortedAuto.length; i++) {
      autoIndexByFile.set(sortedAuto[i]!.logicalPath, i);
    }
    // 全量名单排序：列表行顺序（旧 walkDir 的 sortedFiles 语义）
    const sortedFiles = sortFilesForDir(files.map(metaOf), dirRule).map(
      (m) => m.logicalPath
    );
    plans.set(dir, { autoIndexByFile, autoCount, sortedFiles });
  }
  return plans;
}

/** 各文件 path → 展示档位（宏树后缀与列表 file 行共用）。 */
function buildDisplayByPath(
  scope: WorkplaceScope,
  ctx: WorkplaceRuleContext,
  planByDir: ReadonlyMap<string, DirSortPlan>
): Map<string, DisplayState> {
  const displayByPath = new Map<string, DisplayState>();
  for (const filePath of ctx.fileSet) {
    const parent = parentDirOf(filePath);
    if (parent == null) {
      continue;
    }
    displayByPath.set(
      filePath,
      computeDisplay(scope, ctx, filePath, parent, planByDir)
    );
  }
  return displayByPath;
}

function resolveRuleState(
  scope: WorkplaceScope,
  dirPath: string,
  ctx: WorkplaceRuleContext
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
  ctx: WorkplaceRuleContext
): InclusionMode {
  return ctx.fileRuleMap.get(filePath)?.inclusionMode ?? "auto";
}

function computeDisplay(
  scope: WorkplaceScope,
  ctx: WorkplaceRuleContext,
  filePath: string,
  parentDir: string,
  planByDir: ReadonlyMap<string, DirSortPlan>
): DisplayState {
  const inclusion = resolveInclusion(filePath, ctx);
  const parentRuleOn = resolveRuleState(scope, parentDir, ctx) === "rule_on";
  const dirRule = ctx.dirRuleMap.get(parentDir) ?? null;
  const plan = planByDir.get(parentDir);
  // 非 auto 文件不在 auto 名次表中 → 与旧实现 findIndex<0 → 0 的兜底一致
  const rawIndex = plan?.autoIndexByFile.get(filePath) ?? -1;
  return evaluateFileDisplay({
    inclusion,
    parentRuleOn,
    dirRule,
    indexInSortedAutoFiles: rawIndex < 0 ? 0 : rawIndex,
    autoFileCount: plan?.autoCount ?? 0,
    logicalPath: filePath,
  });
}

function walkDir(
  scope: WorkplaceScope,
  ctx: WorkplaceRuleContext,
  dirPath: string,
  rows: WorkplaceRuleRow[],
  displayByPath: ReadonlyMap<string, DisplayState>,
  planByDir: ReadonlyMap<string, DirSortPlan>
): void {
  rows.push({
    kind: "dir",
    path: dirPath,
    ruleState: resolveRuleState(scope, dirPath, ctx),
  });

  const dirRule = ctx.dirRuleMap.get(dirPath) ?? null;

  const subdirs = sortDirPaths(directChildDirs(dirPath, ctx.allDirs), dirRule);
  for (const sub of subdirs) {
    walkDir(scope, ctx, sub, rows, displayByPath, planByDir);
  }

  const sortedFiles = planByDir.get(dirPath)?.sortedFiles ?? [];
  for (const filePath of sortedFiles) {
    rows.push({
      kind: "file",
      path: filePath,
      inclusionMode: resolveInclusion(filePath, ctx),
      displayState: displayByPath.get(filePath) ?? "hidden",
    });
  }
}
