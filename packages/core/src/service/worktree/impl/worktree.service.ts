/**
 * Default worktree service.
 *
 * @module service/worktree/impl/worktree.service
 */

import {
  assertLogicalPathAllowed,
  scopePhysicalPrefix,
  toLogicalPath,
} from "@/domain/vfs/vfs-path-mapper.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import type { WorktreeRepository } from "@/domain/worktree/repositories/worktree.port.js";
import {
  displayStateLabel,
  inclusionModeLabel,
  ruleStateLabel,
} from "@/domain/worktree/worktree-labels.js";
import {
  buildWorktreeDirSet,
  directChildDirs,
  directChildFiles,
} from "@/domain/worktree/worktree-tree.js";
import {
  evaluateFileDisplay,
  sortDirPaths,
  sortFilesForDir,
  type WorktreeFileSortMeta,
} from "@/domain/worktree/worktree-eval.js";
import { joinFileBlocks, renderFileBlock } from "@/domain/worktree/worktree-display.js";
import {
  isWorktreeRootPath,
  worktreeRootLogicalPath,
  worktreeScopeKey,
} from "@/domain/worktree/worktree-scope.js";
import type {
  DisplayState,
  InclusionMode,
  RuleState,
  SetDirRuleInput,
  SetFileRuleInput,
  WorktreeDirRule,
  WorktreeListRow,
  WorktreeScope,
} from "@/domain/worktree/model/worktree-types.js";
import type { WorktreeService } from "../worktree.port.js";

/** Dependencies for {@link DefaultWorktreeService}. */
export interface WorktreeServiceDeps {
  readonly scope: WorktreeScope;
  readonly vfs: VfsEntryRepository;
  readonly worktree: WorktreeRepository;
}

/**
 * Worktree service backed by vfs_entry and worktree tables.
 */
export class DefaultWorktreeService implements WorktreeService {
  readonly scope: WorktreeScope;

  constructor(private readonly deps: WorktreeServiceDeps) {
    this.scope = deps.scope;
  }

  async setDirRule(input: SetDirRuleInput): Promise<void> {
    const logicalPath = normalizePath(input.logicalPath);
    assertLogicalPathAllowed(this.scope, logicalPath);
    if (
      input.ruleEnabled === false &&
      isWorktreeRootPath(this.scope, logicalPath)
    ) {
      throw new Error("cannot disable rules on root directory");
    }
    const existing = await this.deps.worktree.findDirRule(
      worktreeScopeKey(this.scope),
      logicalPath,
    );
    // Any save without explicit --rule off enables rules (do not preserve prior rule_off).
    const rule: WorktreeDirRule = {
      scopeKey: worktreeScopeKey(this.scope),
      logicalPath,
      ruleEnabled: input.ruleEnabled === false ? false : true,
      sortField: input.sortField ?? existing?.sortField ?? "name",
      sortOrder: input.sortOrder ?? existing?.sortOrder ?? "asc",
      headCount: input.headCount ?? existing?.headCount ?? 0,
      tailCount: input.tailCount ?? existing?.tailCount ?? 0,
      fillPolicy: input.fillPolicy ?? existing?.fillPolicy ?? "hidden",
    };
    await this.deps.worktree.upsertDirRule(rule);
  }

  async setFileRule(input: SetFileRuleInput): Promise<void> {
    const logicalPath = normalizePath(input.logicalPath);
    assertLogicalPathAllowed(this.scope, logicalPath);
    await this.deps.worktree.upsertFileRule({
      scopeKey: worktreeScopeKey(this.scope),
      logicalPath,
      inclusionMode: input.inclusionMode,
    });
  }

  async buildListRows(): Promise<WorktreeListRow[]> {
    const ctx = await this.loadContext();
    const rows: WorktreeListRow[] = [];
    await this.walkDir(ctx, worktreeRootLogicalPath(this.scope), rows, null);
    return rows;
  }

  async renderDisplay(): Promise<string> {
    const ctx = await this.loadContext();
    const blocks: string[] = [];
    await this.walkDir(ctx, worktreeRootLogicalPath(this.scope), [], blocks);
    return joinFileBlocks(blocks);
  }

  private async loadContext(): Promise<TreeContext> {
    const scopeKey = worktreeScopeKey(this.scope);
    const physicalPrefix = scopePhysicalPrefix(this.scope);
    const scanned = await this.deps.vfs.scanContents(physicalPrefix);
    const filePaths = scanned.map((row) =>
      toLogicalPathFromPhysical(this.scope, row.path),
    );
    const dirRules = await this.deps.worktree.listDirRules(scopeKey);
    const fileRules = await this.deps.worktree.listFileRules(scopeKey);
    const dirRuleMap = new Map(dirRules.map((r) => [r.logicalPath, r]));
    const fileRuleMap = new Map(fileRules.map((r) => [r.logicalPath, r]));
    const configuredPaths = [
      ...dirRules.map((r) => r.logicalPath),
      ...fileRules.map((r) => r.logicalPath),
    ];
    const fileSet = new Set(filePaths.map(normalizePath));
    const mtimeByPath = new Map<string, number>();
    const contentByPath = new Map<string, string>();
    for (const row of scanned) {
      const logical = toLogicalPathFromPhysical(this.scope, row.path);
      const entry = await this.deps.vfs.findByPath(row.path);
      if (entry != null) {
        mtimeByPath.set(logical, entry.mtimeMs);
        contentByPath.set(logical, entry.content);
      }
    }
    const allDirs = buildWorktreeDirSet({
      scope: this.scope,
      filePaths: [...fileSet],
      configuredPaths,
    });
    return {
      dirRuleMap,
      fileRuleMap,
      fileSet,
      mtimeByPath,
      contentByPath,
      allDirs,
    };
  }

  private resolveRuleState(
    dirPath: string,
    ctx: TreeContext,
  ): RuleState {
    if (isWorktreeRootPath(this.scope, dirPath)) {
      return "rule_on";
    }
    const rule = ctx.dirRuleMap.get(dirPath);
    if (rule == null || !rule.ruleEnabled) {
      return "rule_off";
    }
    return "rule_on";
  }

  private resolveInclusion(
    filePath: string,
    ctx: TreeContext,
  ): InclusionMode {
    return ctx.fileRuleMap.get(filePath)?.inclusionMode ?? "auto";
  }

  private computeDisplay(
    filePath: string,
    parentDir: string,
    ctx: TreeContext,
  ): DisplayState {
    const inclusion = this.resolveInclusion(filePath, ctx);
    const parentRuleOn = this.resolveRuleState(parentDir, ctx) === "rule_on";
    const dirRule = ctx.dirRuleMap.get(parentDir) ?? null;
    const siblings = directChildFiles(parentDir, ctx.fileSet);
    const autoSiblings: WorktreeFileSortMeta[] = siblings
      .filter((p) => this.resolveInclusion(p, ctx) === "auto")
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

  private async walkDir(
    ctx: TreeContext,
    dirPath: string,
    listRows: WorktreeListRow[],
    displayBlocks: string[] | null,
  ): Promise<void> {
    const ruleState = this.resolveRuleState(dirPath, ctx);
    listRows.push({
      kind: "dir",
      path: dirPath,
      ruleState: ruleStateLabel(ruleState),
      inclusionMode: "",
      displayState: "",
    });

    const files = directChildFiles(dirPath, ctx.fileSet);
    const dirRule = ctx.dirRuleMap.get(dirPath) ?? null;
    const sortedFiles = sortFilesForDir(
      files.map((p) => ({
        logicalPath: p,
        mtimeMs: ctx.mtimeByPath.get(p) ?? 0,
      })),
      dirRule,
    ).map((f) => f.logicalPath);

    for (const filePath of sortedFiles) {
      const inclusion = this.resolveInclusion(filePath, ctx);
      const display = this.computeDisplay(filePath, dirPath, ctx);
      listRows.push({
        kind: "file",
        path: filePath,
        ruleState: "",
        inclusionMode: inclusionModeLabel(inclusion),
        displayState: displayStateLabel(display),
      });
      if (displayBlocks != null && display !== "hidden") {
        const content = ctx.contentByPath.get(filePath) ?? "";
        displayBlocks.push(
          renderFileBlock({
            logicalPath: filePath,
            mtimeMs: ctx.mtimeByPath.get(filePath) ?? 0,
            display,
            content,
          }),
        );
      }
    }

    // Sibling dirs: parent dir rule controls order (not each child's own rule).
    const subdirs = sortDirPaths(directChildDirs(dirPath, ctx.allDirs), dirRule);
    for (const sub of subdirs) {
      await this.walkDir(ctx, sub, listRows, displayBlocks);
    }
  }
}

interface TreeContext {
  readonly dirRuleMap: Map<string, WorktreeDirRule>;
  readonly fileRuleMap: Map<string, import("@/domain/worktree/model/worktree-types.js").WorktreeFileRule>;
  readonly fileSet: Set<string>;
  readonly mtimeByPath: Map<string, number>;
  readonly contentByPath: Map<string, string>;
  readonly allDirs: Set<string>;
}

function toLogicalPathFromPhysical(
  scope: WorktreeScope,
  physical: string,
): string {
  return toLogicalPath(scope, physical);
}
