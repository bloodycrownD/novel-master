/**
 * Default workplace service.
 *
 * @module service/workplace/impl/workplace.service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import {
  assertLogicalPathAllowed,
  scopeKey as vfsScopeKey,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import type { WorkplaceRepository } from "@/domain/workplace/repositories/workplace.port.js";
import { DEFAULT_WORKPLACE_DIR_RULE } from "@/domain/workplace/logic/default-dir-rule.js";
import { buildWorkplaceDirSet } from "@/domain/workplace/logic/workplace-tree.js";
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
import type {
  SmartRuleRowsProvider,
  SmartRulesProvider,
} from "../workplace.port.js";
import {
  ensureWorkplaceViewEntry,
  getCachedWorkplaceView,
  publishWorkplaceView,
  type WorkplaceViewCacheValue,
  type WorkplaceViewSigs,
} from "./workplace-view-cache.js";

/** Dependencies for {@link DefaultWorkplaceService}. */
export interface WorkplaceServiceDeps {
  readonly scope: WorkplaceScope;
  /** conn 级 L1 memo 的 WeakMap key（见 workplace-view-cache.ts）。 */
  readonly conn: TdbcConnection;
  readonly vfs: VfsEntryRepository;
  readonly workplace: WorkplaceRepository;
  /** 懒加载智能规则 provider；缺省时 smart 排序退化为自然排序（D4）。 */
  readonly smartRules?: SmartRulesProvider;
  /** 智能规则原始行 provider（L1 签名采样，core/B-3）；缺省时该来源不参与失效。 */
  readonly smartRuleRows?: SmartRuleRowsProvider;
}

/**
 * Workplace service backed by vfs_entry and workplace tables.
 */
export class DefaultWorkplaceService implements WorkplaceService {
  readonly scope: WorkplaceScope;

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
      logicalPath
    );
    // Any save without explicit --rule off enables rules (do not preserve prior rule_off).
    const rule: WorkplaceDirRule = {
      scopeKey: workplaceScopeKey(this.scope),
      logicalPath,
      ruleEnabled: input.ruleEnabled === false ? false : true,
      sortField:
        input.sortField ??
        existing?.sortField ??
        DEFAULT_WORKPLACE_DIR_RULE.sortField,
      sortOrder:
        input.sortOrder ??
        existing?.sortOrder ??
        DEFAULT_WORKPLACE_DIR_RULE.sortOrder,
      headCount:
        input.headCount ??
        existing?.headCount ??
        DEFAULT_WORKPLACE_DIR_RULE.headCount,
      tailCount:
        input.tailCount ??
        existing?.tailCount ??
        DEFAULT_WORKPLACE_DIR_RULE.tailCount,
      fillPolicy:
        input.fillPolicy ??
        existing?.fillPolicy ??
        DEFAULT_WORKPLACE_DIR_RULE.fillPolicy,
    };
    await this.deps.workplace.upsertDirRule(rule);
  }

  async getDirRule(logicalPath: string): Promise<WorkplaceDirRule | undefined> {
    const normalized = normalizePath(logicalPath);
    assertLogicalPathAllowed(this.scope, normalized);
    const rule = await this.deps.workplace.findDirRule(
      workplaceScopeKey(this.scope),
      normalized
    );
    return rule ?? undefined;
  }

  async listDirRules(): Promise<WorkplaceDirRule[]> {
    return this.deps.workplace.listDirRules(workplaceScopeKey(this.scope));
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
      normalized
    );
  }

  async renameRulesUnderLogicalPrefix(
    oldPrefix: string,
    newPrefix: string
  ): Promise<void> {
    const oldNormalized = normalizePath(oldPrefix);
    const newNormalized = normalizePath(newPrefix);
    assertLogicalPathAllowed(this.scope, oldNormalized);
    assertLogicalPathAllowed(this.scope, newNormalized);
    await this.deps.workplace.renameRulesUnderLogicalPrefix(
      workplaceScopeKey(this.scope),
      oldNormalized,
      newNormalized
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
    // 并发去重由 conn 级缓存 entry.inFlight 承接（升级为跨实例，语义等价于
    // 原实例级 liveViewInFlight 的合并行为）。
    return this.doMaterializeLiveView();
  }

  async materializePersistBlock(): Promise<WorkplacePersistBlock> {
    const value = await this.evaluateCachedView();
    // 缓存命中时复用缓存 ctx 的 mtimeByPath：mtime 变化必然改变 vfs 签名
    // 触发整条重算，读-改-写一致性不受损。
    const workplaceDisplay = await materializeBlockFromView(
      value.view,
      this.deps.vfs,
      this.scope,
      value.ctx.mtimeByPath
    );
    return { workplaceDisplay };
  }

  async evaluateRuleView(): Promise<WorkplaceRuleView> {
    const value = await this.evaluateCachedView();
    return value.view;
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
    const value = await this.evaluateCachedView();
    return { listRows: value.view.rows, filetreeDisplay: value.filetreeDisplay };
  }

  /**
   * 读时校验的缓存化评估：采样签名 → 命中直接返回缓存 → 未命中经 entry.inFlight
   * 并发去重计算（loadContextMetadata + evaluate + filetree render）→ 发布时
   * 携带计算**前**采样的 sigs（计算期间有写时下一个读者自愈，脏结果最多存活一次）。
   */
  private async evaluateCachedView(): Promise<WorkplaceViewCacheValue> {
    const conn = this.deps.conn;
    const cacheKey = workplaceScopeKey(this.scope);
    const sigs = await this.sampleSignatures();
    const entry = ensureWorkplaceViewEntry(conn, cacheKey);
    const cached = getCachedWorkplaceView(entry, sigs);
    if (cached != null) {
      return cached;
    }
    if (entry.inFlight != null) {
      return entry.inFlight;
    }
    const computing = this.computeFullViewValue();
    entry.inFlight = computing;
    try {
      const value = await computing;
      publishWorkplaceView(conn, cacheKey, sigs, value);
      return value;
    } finally {
      if (entry.inFlight === computing) {
        entry.inFlight = undefined;
      }
    }
  }

  /** 完整评估三件套（ctx + view + filetree），供 inFlight 去重共享。 */
  private async computeFullViewValue(): Promise<WorkplaceViewCacheValue> {
    const ctx = await this.loadContextMetadata();
    const view = evaluateWorkplaceRuleView(this.scope, ctx);
    const filetreeDisplay = renderWorkplaceFileTreeForMacro({
      scope: this.scope,
      allDirs: ctx.allDirs,
      fileSet: ctx.fileSet,
      dirRuleMap: ctx.dirRuleMap,
      mtimeByPath: ctx.mtimeByPath,
      smartRules: ctx.smartRules,
      dirMtimeByPath: ctx.dirMtimeByPath,
      displayByPath: view.displayByPath,
    });
    return { ctx, view, filetreeDisplay };
  }

  /**
   * 采样读时校验值：vfs 聚合签名（1 条 SQL）+ 规则表全量重读按 logicalPath
   * 排序后的确定性 JSON 序列化（规则表无版本列且存在同数改写，不做聚合指纹）
   * + smart_sort_rule 全量按 sort_order 排序后的确定性序列化（原始行不编译，
   * core/B-3：增删改/启停/调序智能规则部合反映到签名，改规则后排序即时刷新）。
   */
  private async sampleSignatures(): Promise<WorkplaceViewSigs> {
    const scopeKey = workplaceScopeKey(this.scope);
    const vfsKey = vfsScopeKey(this.scope);
    const vfs = await this.deps.vfs.computeEntrySignature(vfsKey);
    const dirRules = await this.deps.workplace.listDirRules(scopeKey);
    const fileRules = await this.deps.workplace.listFileRules(scopeKey);
    const byLogicalPath = (
      a: { logicalPath: string },
      b: { logicalPath: string }
    ) => (a.logicalPath < b.logicalPath ? -1 : a.logicalPath > b.logicalPath ? 1 : 0);
    dirRules.sort(byLogicalPath);
    fileRules.sort(byLogicalPath);
    // 无条件采样（表小成本可忽略，管理页改规则低频，过度失效可接受）；
    // listOrdered 已按 sort_order 排序，行对象由 repo 字面量构造，序列化确定。
    const smartRuleRows =
      this.deps.smartRuleRows != null
        ? await this.deps.smartRuleRows()
        : [];
    return {
      vfs,
      rules: JSON.stringify([dirRules, fileRules]),
      smartRules: JSON.stringify(smartRuleRows),
    };
  }

  /** Loads path/mtime/rules context without scanning file content. */
  private async loadContextMetadata(): Promise<WorkplaceRuleContext> {
    const scopeKey = workplaceScopeKey(this.scope);
    const vfsKey = vfsScopeKey(this.scope);
    // entry_id 化后 path 列直接存逻辑路径，整个 scope 列在 "/" 前缀下
    const fileMeta = await this.deps.vfs.listFileMetaUnderPrefix(vfsKey, "/");
    const dirRules = await this.deps.workplace.listDirRules(scopeKey);
    const fileRules = await this.deps.workplace.listFileRules(scopeKey);
    const dirRuleMap = new Map(dirRules.map((r) => [r.logicalPath, r]));
    const fileRuleMap = new Map(fileRules.map((r) => [r.logicalPath, r]));
    const configuredPaths = [
      ...dirRules.map((r) => r.logicalPath),
      ...fileRules.map((r) => r.logicalPath),
    ];
    const fileSet = new Set(fileMeta.map((row) => normalizePath(row.path)));
    const mtimeByPath = new Map<string, number>();
    for (const row of fileMeta) {
      mtimeByPath.set(row.path, row.mtimeMs);
    }
    const allDirs = buildWorkplaceDirSet({
      scope: this.scope,
      filePaths: [...fileSet],
      configuredPaths,
    });
    const dirPaths = await this.deps.vfs.listDirectoryPathsUnderPrefix(
      vfsKey,
      "/"
    );
    for (const logical of dirPaths) {
      allDirs.add(logical);
    }
    const dirMtimeByPath = new Map<string, number>();
    for (const row of await this.deps.vfs.listDirectoryMetaUnderPrefix(
      vfsKey,
      "/"
    )) {
      dirMtimeByPath.set(row.path, row.mtimeMs);
    }
    // 懒加载（Step 6）：仅当存在 sortField='smart' 的目录规则时才查表编译。
    // 与排序消费端（sortFilesForDir / sortDirPaths）共用同一基线口径——只看
    // sortField、不看 ruleEnabled：disabled 目录规则的排序配置仍生效（与
    // created/updated 的 disabled-仍生效基线对齐），单条规则是否启用由编译
    // 结果决定（disabled 规则不参与编译），不在加载侧预过滤。
    const smartRules =
      this.deps.smartRules != null &&
      [...dirRuleMap.values()].some((r) => r.sortField === "smart")
        ? await this.deps.smartRules()
        : undefined;
    return {
      dirRuleMap,
      fileRuleMap,
      fileSet,
      mtimeByPath,
      allDirs,
      smartRules,
      dirMtimeByPath,
    };
  }
}
