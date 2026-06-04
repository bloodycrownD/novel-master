/**
 * Default worktree service.
 *
 * @module service/worktree/impl/worktree.service
 */

import {
  assertLogicalPathAllowed,
  scopePhysicalPrefix,
  toLogicalPath,
  toPhysicalPath,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import type { WorktreeRepository } from "@/domain/worktree/repositories/worktree.port.js";
import {
  displayStateLabel,
  inclusionModeLabel,
  ruleStateLabel,
} from "@/domain/worktree/logic/worktree-labels.js";
import { DEFAULT_WORKTREE_DIR_RULE } from "@/domain/worktree/logic/default-dir-rule.js";
import {
  buildWorktreeDirSet,
  directChildDirs,
  directChildFiles,
} from "@/domain/worktree/logic/worktree-tree.js";
import {
  evaluateFileDisplay,
  sortDirPaths,
  sortFilesForDir,
  type WorktreeFileSortMeta,
} from "@/domain/worktree/logic/worktree-eval.js";
import { joinFileBlocks, renderFileBlock } from "@/domain/worktree/logic/worktree-display.js";
import { renderWorktreeFileTree } from "@/domain/worktree/logic/worktree-file-tree.js";
import {
  isWorktreeRootPath,
  worktreeRootLogicalPath,
  worktreeScopeKey,
} from "@/domain/worktree/logic/worktree-scope.js";
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
import type { WorktreeMaterialized, WorktreeService } from "../worktree.port.js";

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
      sortField:
        input.sortField ?? existing?.sortField ?? DEFAULT_WORKTREE_DIR_RULE.sortField,
      sortOrder:
        input.sortOrder ?? existing?.sortOrder ?? DEFAULT_WORKTREE_DIR_RULE.sortOrder,
      headCount:
        input.headCount ?? existing?.headCount ?? DEFAULT_WORKTREE_DIR_RULE.headCount,
      tailCount:
        input.tailCount ?? existing?.tailCount ?? DEFAULT_WORKTREE_DIR_RULE.tailCount,
      fillPolicy:
        input.fillPolicy ?? existing?.fillPolicy ?? DEFAULT_WORKTREE_DIR_RULE.fillPolicy,
    };
    await this.deps.worktree.upsertDirRule(rule);
  }

  async getDirRule(logicalPath: string): Promise<WorktreeDirRule | undefined> {
    const normalized = normalizePath(logicalPath);
    assertLogicalPathAllowed(this.scope, normalized);
    const rule = await this.deps.worktree.findDirRule(
      worktreeScopeKey(this.scope),
      normalized,
    );
    return rule ?? undefined;
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

  async materialize(): Promise<WorktreeMaterialized> {
    const ctx = await this.loadContextMetadata();
    const listRows: WorktreeListRow[] = [];
    const blocks: string[] = [];
    await this.walkDir(
      ctx,
      worktreeRootLogicalPath(this.scope),
      listRows,
      blocks,
    );
    return {
      listRows,
      worktreeDisplay: joinFileBlocks(blocks),
      filetreeDisplay: renderWorktreeFileTree({
        scope: this.scope,
        allDirs: ctx.allDirs,
        fileSet: ctx.fileSet,
        dirRuleMap: ctx.dirRuleMap,
        mtimeByPath: ctx.mtimeByPath,
      }),
    };
  }

  async buildListRows(): Promise<WorktreeListRow[]> {
    const ctx = await this.loadContextMetadata();
    const rows: WorktreeListRow[] = [];
    // List-only walk: metadata path never reads file content.
    await this.walkDir(ctx, worktreeRootLogicalPath(this.scope), rows, null);
    return rows;
  }

  async renderDisplay(): Promise<string> {
    return (await this.materialize()).worktreeDisplay;
  }

  async renderFileTree(): Promise<string> {
    const ctx = await this.loadContextMetadata();
    return renderWorktreeFileTree({
      scope: this.scope,
      allDirs: ctx.allDirs,
      fileSet: ctx.fileSet,
      dirRuleMap: ctx.dirRuleMap,
      mtimeByPath: ctx.mtimeByPath,
    });
  }

  /** Loads path/mtime/rules context without scanning file content. */
  private async loadContextMetadata(): Promise<TreeContextMetadata> {
    const scopeKey = worktreeScopeKey(this.scope);
    const physicalPrefix = scopePhysicalPrefix(this.scope);
    const fileMeta = await this.deps.vfs.listFileMetaUnderPrefix(physicalPrefix);
    const dirRules = await this.deps.worktree.listDirRules(scopeKey);
    const fileRules = await this.deps.worktree.listFileRules(scopeKey);
    const dirRuleMap = new Map(dirRules.map((r) => [r.logicalPath, r]));
    const fileRuleMap = new Map(fileRules.map((r) => [r.logicalPath, r]));
    const configuredPaths = [
      ...dirRules.map((r) => r.logicalPath),
      ...fileRules.map((r) => r.logicalPath),
    ];
    const fileSet = new Set(
      fileMeta.map((row) =>
        normalizePath(toLogicalPathFromPhysical(this.scope, row.path)),
      ),
    );
    const mtimeByPath = new Map<string, number>();
    for (const row of fileMeta) {
      const logical = toLogicalPathFromPhysical(this.scope, row.path);
      mtimeByPath.set(logical, row.mtimeMs);
    }
    const allDirs = buildWorktreeDirSet({
      scope: this.scope,
      filePaths: [...fileSet],
      configuredPaths,
    });
    const dirPaths = await this.deps.vfs.listDirectoryPathsUnderPrefix(
      physicalPrefix,
    );
    for (const physicalDir of dirPaths) {
      const logical = toLogicalPathFromPhysical(this.scope, physicalDir);
      allDirs.add(logical);
    }
    return {
      dirRuleMap,
      fileRuleMap,
      fileSet,
      mtimeByPath,
      allDirs,
    };
  }

  private resolveRuleState(
    dirPath: string,
    ctx: TreeContextMetadata,
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
    ctx: TreeContextMetadata,
  ): InclusionMode {
    return ctx.fileRuleMap.get(filePath)?.inclusionMode ?? "auto";
  }

  private computeDisplay(
    filePath: string,
    parentDir: string,
    ctx: TreeContextMetadata,
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
    ctx: TreeContextMetadata,
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

    const dirRule = ctx.dirRuleMap.get(dirPath) ?? null;

    // DFS: child directories before sibling files (parent dir rule sorts both).
    const subdirs = sortDirPaths(directChildDirs(dirPath, ctx.allDirs), dirRule);
    for (const sub of subdirs) {
      await this.walkDir(ctx, sub, listRows, displayBlocks);
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
        let content = "";
        // Lazy content read: only full/header display modes need file body.
        if (display === "full" || display === "header") {
          const physical = toPhysicalPath(this.scope, filePath);
          const entry = await this.deps.vfs.findByPath(physical);
          content = entry?.content ?? "";
        }
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
  }
}

interface TreeContextMetadata {
  readonly dirRuleMap: Map<string, WorktreeDirRule>;
  readonly fileRuleMap: Map<
    string,
    import("@/domain/worktree/model/worktree-types.js").WorktreeFileRule
  >;
  readonly fileSet: Set<string>;
  readonly mtimeByPath: Map<string, number>;
  readonly allDirs: Set<string>;
}

function toLogicalPathFromPhysical(
  scope: WorktreeScope,
  physical: string,
): string {
  return toLogicalPath(scope, physical);
}
