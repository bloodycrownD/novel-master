/**
 * Default workplace service.
 *
 * @module service/workplace/impl/workplace.service
 */

import {
  assertLogicalPathAllowed,
  scopePhysicalPrefix,
  toLogicalPath,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import type { WorkplaceRepository } from "@/domain/workplace/repositories/workplace.port.js";
import { DEFAULT_WORKPLACE_DIR_RULE } from "@/domain/workplace/logic/default-dir-rule.js";
import {
  buildWorkplaceDirSet,
} from "@/domain/workplace/logic/workplace-tree.js";
import { materializeBlockFromView } from "@/domain/workplace/logic/workplace-materialize-engine.js";
import { renderWorkplaceFileTreeForMacro } from "@/domain/workplace/logic/workplace-file-tree.js";
import { evaluateWorkplaceRuleView } from "@/domain/workplace/logic/workplace-rule-engine.js";
import {
  isWorkplaceRootPath,
  workplaceScopeKey,
} from "@/domain/workplace/logic/workplace-scope.js";
import type {
  SetDirRuleInput,
  SetFileRuleInput,
  WorkplaceDirRule,
  WorkplaceListRow,
  WorkplaceScope,
} from "@/domain/workplace/model/workplace-types.js";
import type {
  WorkplaceRuleContext,
  WorkplaceRuleView,
} from "@/domain/workplace/model/workplace-rule-view.js";
import type {
  WorkplaceLiveView,
  WorkplaceMaterialized,
  WorkplacePersistBlock,
  WorkplaceService,
} from "../workplace.port.js";

/** Dependencies for {@link DefaultWorkplaceService}. */
export interface WorkplaceServiceDeps {
  readonly scope: WorkplaceScope;
  readonly vfs: VfsEntryRepository;
  readonly workplace: WorkplaceRepository;
}

/**
 * Workplace service backed by vfs_entry and workplace tables.
 */
export class DefaultWorkplaceService implements WorkplaceService {
  readonly scope: WorkplaceScope;

  /** 并发 materializeLiveView 合并为单次 metadata 加载。 */
  private liveViewInFlight: Promise<WorkplaceLiveView> | null = null;

  constructor(private readonly deps: WorkplaceServiceDeps) {
    this.scope = deps.scope;
  }

  async setDirRule(input: SetDirRuleInput): Promise<void> {
    const logicalPath = normalizePath(input.logicalPath);
    assertLogicalPathAllowed(this.scope, logicalPath);
    if (
      input.ruleEnabled === false &&
      isWorkplaceRootPath(this.scope, logicalPath)
    ) {
      throw new Error("cannot disable rules on root directory");
    }
    const existing = await this.deps.workplace.findDirRule(
      workplaceScopeKey(this.scope),
      logicalPath,
    );
    // Any save without explicit --rule off enables rules (do not preserve prior rule_off).
    const rule: WorkplaceDirRule = {
      scopeKey: workplaceScopeKey(this.scope),
      logicalPath,
      ruleEnabled: input.ruleEnabled === false ? false : true,
      sortField:
        input.sortField ?? existing?.sortField ?? DEFAULT_WORKPLACE_DIR_RULE.sortField,
      sortOrder:
        input.sortOrder ?? existing?.sortOrder ?? DEFAULT_WORKPLACE_DIR_RULE.sortOrder,
      headCount:
        input.headCount ?? existing?.headCount ?? DEFAULT_WORKPLACE_DIR_RULE.headCount,
      tailCount:
        input.tailCount ?? existing?.tailCount ?? DEFAULT_WORKPLACE_DIR_RULE.tailCount,
      fillPolicy:
        input.fillPolicy ?? existing?.fillPolicy ?? DEFAULT_WORKPLACE_DIR_RULE.fillPolicy,
    };
    await this.deps.workplace.upsertDirRule(rule);
  }

  async getDirRule(logicalPath: string): Promise<WorkplaceDirRule | undefined> {
    const normalized = normalizePath(logicalPath);
    assertLogicalPathAllowed(this.scope, normalized);
    const rule = await this.deps.workplace.findDirRule(
      workplaceScopeKey(this.scope),
      normalized,
    );
    return rule ?? undefined;
  }

  async setFileRule(input: SetFileRuleInput): Promise<void> {
    const logicalPath = normalizePath(input.logicalPath);
    assertLogicalPathAllowed(this.scope, logicalPath);
    await this.deps.workplace.upsertFileRule({
      scopeKey: workplaceScopeKey(this.scope),
      logicalPath,
      inclusionMode: input.inclusionMode,
    });
  }

  async deleteRulesUnderLogicalPrefix(logicalPrefix: string): Promise<void> {
    const normalized = normalizePath(logicalPrefix);
    assertLogicalPathAllowed(this.scope, normalized);
    await this.deps.workplace.deleteRulesUnderLogicalPrefix(
      workplaceScopeKey(this.scope),
      normalized,
    );
  }

  /** @deprecated 使用 {@link materializeLiveView} / {@link materializePersistBlock}。 */
  async materialize(): Promise<WorkplaceMaterialized> {
    const [live, persist] = await Promise.all([
      this.materializeLiveView(),
      this.materializePersistBlock(),
    ]);
    return {
      listRows: live.listRows,
      workplaceDisplay: persist.workplaceDisplay,
      filetreeDisplay: live.filetreeDisplay,
    };
  }

  async materializeLiveView(): Promise<WorkplaceLiveView> {
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

  async materializePersistBlock(): Promise<WorkplacePersistBlock> {
    const ctx = await this.loadContextMetadata();
    const view = evaluateWorkplaceRuleView(this.scope, ctx);
    const workplaceDisplay = await materializeBlockFromView(
      view,
      this.deps.vfs,
      this.scope,
      ctx.mtimeByPath,
    );
    return { workplaceDisplay };
  }

  async evaluateRuleView(): Promise<WorkplaceRuleView> {
    const ctx = await this.loadContextMetadata();
    return evaluateWorkplaceRuleView(this.scope, ctx);
  }

  async buildListRows(): Promise<WorkplaceListRow[]> {
    const live = await this.materializeLiveView();
    return [...live.listRows];
  }

  async renderDisplay(): Promise<string> {
    return (await this.materializePersistBlock()).workplaceDisplay;
  }

  async renderFileTree(): Promise<string> {
    return (await this.materializeLiveView()).filetreeDisplay;
  }

  private async doMaterializeLiveView(): Promise<WorkplaceLiveView> {
    const ctx = await this.loadContextMetadata();
    const view = evaluateWorkplaceRuleView(this.scope, ctx);
    const filetreeDisplay = renderWorkplaceFileTreeForMacro({
      scope: this.scope,
      allDirs: ctx.allDirs,
      fileSet: ctx.fileSet,
      dirRuleMap: ctx.dirRuleMap,
      mtimeByPath: ctx.mtimeByPath,
      displayByPath: view.displayByPath,
    });
    return { listRows: view.rows, filetreeDisplay };
  }

  /** Loads path/mtime/rules context without scanning file content. */
  private async loadContextMetadata(): Promise<WorkplaceRuleContext> {
    const scopeKey = workplaceScopeKey(this.scope);
    const physicalPrefix = scopePhysicalPrefix(this.scope);
    const fileMeta = await this.deps.vfs.listFileMetaUnderPrefix(physicalPrefix);
    const dirRules = await this.deps.workplace.listDirRules(scopeKey);
    const fileRules = await this.deps.workplace.listFileRules(scopeKey);
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
    const allDirs = buildWorkplaceDirSet({
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
  scope: WorkplaceScope,
  physical: string,
): string {
  return toLogicalPath(scope, physical);
}
