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

import { WorkplaceEval, type WorkplaceFileSortMeta } from "./workplace-eval.js";
import { WorkplaceTree } from "./workplace-tree.js";
import { WorkplaceScope } from "./workplace-scope.js";
import { ParentDir } from "@/domain/vfs/logic/parent-dir.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { DisplayState, InclusionMode, RuleState, WorkplaceRuleRow, WorkplaceScope as WorkplaceScopeType } from "../model/workplace-types.js";
import type { WorkplaceRuleContext, WorkplaceRuleView } from "../model/workplace-rule-view.js";

/** 每个目录一次性的排序产物：auto 排名 + 完整子文件序列。 */
interface DirSortPlan {
  /** auto 纳入文件在排序后的名次（0 起）；非 auto 文件不在表中。 */
  readonly autoIndexByFile: ReadonlyMap<string, number>;
  /** auto 纳入文件总数（旧实现 `sortedAuto.length` 语义）。 */
  readonly autoCount: number;
  /** 排序后的全部直接子文件（列表行顺序，walkDir 用）。 */
  readonly sortedFiles: readonly string[];
}

export const WorkplaceRuleEngine = {
  /**
   * 评估工作区规则视图：纯规则 DFS，不算文件正文。
   *
   * 排序产物（buildDirSortPlans / buildDisplayByPath / computeDisplay 均已内联）：
   * 一次遍历按父目录分组，每个目录只排序两次（auto 名单 / 全量名单），名次与
   * 序列缓存在 Map 中——排序成本从 O(N²·logN) 降为 O(N·logN)。
   */
  evaluateView(scope: WorkplaceScopeType, ctx: WorkplaceRuleContext): Result<WorkplaceRuleView, AppError> {
    const filesByDir = new Map<string, string[]>();
    for (const filePath of ctx.fileSet) {
      // ctx.fileSet 已由 workplace.service 归一化；root 处返回 null（无父目录）。
      const parent = ParentDir.orNull(filePath);
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

    const planByDir = new Map<string, DirSortPlan>();
    for (const [dir, files] of filesByDir) {
      const dirRule = ctx.dirRuleMap.get(dir) ?? null;
      const autoIndexByFile = new Map<string, number>();
      // auto 名单单独排序：名次与总数（旧 computeDisplay 的 sortedAuto 语义）
      const autoMetas: WorkplaceFileSortMeta[] = [];
      for (const p of files) {
        if (WorkplaceRuleEngine.resolveInclusion(p, ctx) === "auto") {
          autoMetas.push(metaOf(p));
        }
      }
      const sortedAuto = WorkplaceEval.sortFilesForDir(autoMetas, dirRule, {
        smartRules: ctx.smartRules,
      });
      const autoCount = sortedAuto.length;
      for (let i = 0; i < sortedAuto.length; i++) {
        autoIndexByFile.set(sortedAuto[i]!.logicalPath, i);
      }
      // 全量名单排序：列表行顺序（旧 walkDir 的 sortedFiles 语义）
      const sortedFiles = WorkplaceEval.sortFilesForDir(files.map(metaOf), dirRule, {
        smartRules: ctx.smartRules,
      }).map((m) => m.logicalPath);
      planByDir.set(dir, { autoIndexByFile, autoCount, sortedFiles });
    }

    // 各文件 path → 展示档位（宏树后缀与列表 file 行共用）。
    const displayByPath = new Map<string, DisplayState>();
    for (const filePath of ctx.fileSet) {
      // ctx.fileSet 已由 workplace.service 归一化；root 处返回 null（无父目录）。
      const parent = ParentDir.orNull(filePath);
      if (parent == null) {
        continue;
      }
      const inclusion = WorkplaceRuleEngine.resolveInclusion(filePath, ctx);
      const parentRuleOn = WorkplaceRuleEngine.resolveRuleState(scope, parent, ctx) === "rule_on";
      const dirRule = ctx.dirRuleMap.get(parent) ?? null;
      const plan = planByDir.get(parent);
      // 非 auto 文件不在 auto 名次表中 → 与旧实现 findIndex<0 → 0 的兜底一致
      const rawIndex = plan?.autoIndexByFile.get(filePath) ?? -1;
      displayByPath.set(filePath, WorkplaceEval.evaluateFileDisplay({ inclusion, parentRuleOn, dirRule, indexInSortedAutoFiles: rawIndex < 0 ? 0 : rawIndex, autoFileCount: plan?.autoCount ?? 0, logicalPath: filePath }));
    }

    const rows: WorkplaceRuleRow[] = [];
    const walked = WorkplaceRuleEngine.walkDir(scope, ctx, WorkplaceScope.rootLogicalPath(scope), rows, displayByPath, planByDir);
    if (!walked.ok) return Result.err(walked.error);
    return Result.ok({ rows, displayByPath });
  },

  resolveRuleState(scope: WorkplaceScopeType, dirPath: string, ctx: WorkplaceRuleContext): RuleState {
    if (WorkplaceScope.isRootPath(scope, dirPath)) {
      return "rule_on";
    }
    const rule = ctx.dirRuleMap.get(dirPath);
    if (rule == null || !rule.ruleEnabled) {
      return "rule_off";
    }
    return "rule_on";
  },

  resolveInclusion(filePath: string, ctx: WorkplaceRuleContext): InclusionMode {
    return ctx.fileRuleMap.get(filePath)?.inclusionMode ?? "auto";
  },

  /**
   * nm-style: keep-local — 递归 DFS 遍历：自身递归调用 + 顶层单点调用，内联需再造
   * 一个具名递归函数；rows / displayByPath / planByDir 三个游标在此阶段内共享。
   */
  walkDir(scope: WorkplaceScopeType, ctx: WorkplaceRuleContext, dirPath: string, rows: WorkplaceRuleRow[], displayByPath: ReadonlyMap<string, DisplayState>, planByDir: ReadonlyMap<string, DirSortPlan>): Result<void, AppError> {
    rows.push({
      kind: "dir",
      path: dirPath,
      ruleState: WorkplaceRuleEngine.resolveRuleState(scope, dirPath, ctx),
    });

    const dirRule = ctx.dirRuleMap.get(dirPath) ?? null;

    const children = WorkplaceTree.directChildDirs(dirPath, ctx.allDirs);
    if (!children.ok) return Result.err(children.error);
    const subdirs = WorkplaceEval.sortDirPaths(children.value, dirRule, { smartRules: ctx.smartRules, dirMtimeByPath: ctx.dirMtimeByPath });
    for (const sub of subdirs) {
      const walked = WorkplaceRuleEngine.walkDir(scope, ctx, sub, rows, displayByPath, planByDir);
      if (!walked.ok) return Result.err(walked.error);
    }

    const sortedFiles = planByDir.get(dirPath)?.sortedFiles ?? [];
    for (const filePath of sortedFiles) {
      rows.push({
        kind: "file",
        path: filePath,
        inclusionMode: WorkplaceRuleEngine.resolveInclusion(filePath, ctx),
        displayState: displayByPath.get(filePath) ?? "hidden",
      });
    }
    return Result.ok(undefined);
  },
} as const;
