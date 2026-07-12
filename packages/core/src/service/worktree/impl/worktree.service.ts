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
import { DEFAULT_WORKTREE_DIR_RULE } from "@/domain/worktree/logic/default-dir-rule.js";
import {
  buildWorktreeDirSet,
} from "@/domain/worktree/logic/worktree-tree.js";
import { joinFileBlocks, renderFileBlock } from "@/domain/worktree/logic/worktree-display.js";
import { renderWorktreeFileTreeForMacro } from "@/domain/worktree/logic/worktree-file-tree.js";
import { evaluateWorktreeRuleView } from "@/domain/worktree/logic/worktree-rule-engine.js";
import {
  isWorktreeRootPath,
  worktreeScopeKey,
} from "@/domain/worktree/logic/worktree-scope.js";
import type {
  DisplayState,
  SetDirRuleInput,
  SetFileRuleInput,
  WorktreeDirRule,
  WorktreeListRow,
  WorktreeScope,
} from "@/domain/worktree/model/worktree-types.js";
import type { WorktreeRuleContext } from "@/domain/worktree/model/worktree-rule-view.js";
import type {
  WorktreeLiveView,
  WorktreeMaterialized,
  WorktreePersistBlock,
  WorktreeService,
} from "../worktree.port.js";

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

  /** 并发 materializeLiveView 合并为单次 metadata 加载。 */
  private liveViewInFlight: Promise<WorktreeLiveView> | null = null;

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

  async deleteRulesUnderLogicalPrefix(logicalPrefix: string): Promise<void> {
    const normalized = normalizePath(logicalPrefix);
    assertLogicalPathAllowed(this.scope, normalized);
    await this.deps.worktree.deleteRulesUnderLogicalPrefix(
      worktreeScopeKey(this.scope),
      normalized,
    );
  }

  /** @deprecated 使用 {@link materializeLiveView} / {@link materializePersistBlock}。 */
  async materialize(): Promise<WorktreeMaterialized> {
    const [live, persist] = await Promise.all([
      this.materializeLiveView(),
      this.materializePersistBlock(),
    ]);
    return {
      listRows: live.listRows,
      worktreeDisplay: persist.worktreeDisplay,
      filetreeDisplay: live.filetreeDisplay,
    };
  }

  async materializeLiveView(): Promise<WorktreeLiveView> {
    if (this.liveViewInFlight != null) {
      return this.liveViewInFlight;
    }
    const inFlight = this.doMaterializeLiveView();
    this.liveViewInFlight = inFlight;
    try {
      return await inFlight;
    } finally {
      if (this.liveViewInFlight === inFlight) {
        this.liveViewInFlight = null;
      }
    }
  }

  async materializePersistBlock(): Promise<WorktreePersistBlock> {
    const ctx = await this.loadContextMetadata();
    const view = evaluateWorktreeRuleView(this.scope, ctx);
    const blocks = await this.collectDisplayBlocks(ctx, view);
    return { worktreeDisplay: joinFileBlocks(blocks) };
  }

  async buildListRows(): Promise<WorktreeListRow[]> {
    const live = await this.materializeLiveView();
    return [...live.listRows];
  }

  async renderDisplay(): Promise<string> {
    return (await this.materializePersistBlock()).worktreeDisplay;
  }

  async renderFileTree(): Promise<string> {
    return (await this.materializeLiveView()).filetreeDisplay;
  }

  private async doMaterializeLiveView(): Promise<WorktreeLiveView> {
    const ctx = await this.loadContextMetadata();
    const view = evaluateWorktreeRuleView(this.scope, ctx);
    const filetreeDisplay = renderWorktreeFileTreeForMacro({
      scope: this.scope,
      allDirs: ctx.allDirs,
      fileSet: ctx.fileSet,
      dirRuleMap: ctx.dirRuleMap,
      mtimeByPath: ctx.mtimeByPath,
      displayByPath: view.displayByPath,
    });
    return { listRows: view.rows, filetreeDisplay };
  }

  /** 按 DFS 文件行顺序收集持久块（仅非 hidden 且 full/header 读正文）。 */
  private async collectDisplayBlocks(
    ctx: WorktreeRuleContext,
    view: { readonly rows: readonly WorktreeListRow[]; readonly displayByPath: ReadonlyMap<string, DisplayState> },
  ): Promise<string[]> {
    const blocks: string[] = [];
    for (const row of view.rows) {
      if (row.kind !== "file") {
        continue;
      }
      const display = view.displayByPath.get(row.path) ?? row.displayState;
      if (display === "hidden") {
        continue;
      }
      let content = "";
      if (display === "full" || display === "header") {
        const physical = toPhysicalPath(this.scope, row.path);
        const entry = await this.deps.vfs.findByPath(physical);
        content = entry?.content ?? "";
      }
      blocks.push(
        renderFileBlock({
          logicalPath: row.path,
          mtimeMs: ctx.mtimeByPath.get(row.path) ?? 0,
          display,
          content,
        }),
      );
    }
    return blocks;
  }

  /** Loads path/mtime/rules context without scanning file content. */
  private async loadContextMetadata(): Promise<WorktreeRuleContext> {
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
}

function toLogicalPathFromPhysical(
  scope: WorktreeScope,
  physical: string,
): string {
  return toLogicalPath(scope, physical);
}
