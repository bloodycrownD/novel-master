/**
 * Default workplace service.
 *
 * @module service/workplace/impl/workplace.service
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { LogicalPath } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { PathNormalizer } from "@/domain/vfs/repositories/impl/normalize-path.js";
import type { WorkplaceRepository } from "@/domain/workplace/repositories/workplace.port.js";
import { DEFAULT_WORKPLACE_DIR_RULE } from "@/domain/workplace/logic/default-dir-rule.js";
import { WorkplaceTree } from "@/domain/workplace/logic/workplace-tree.js";
import { WorkplaceMaterializeEngine } from "@/domain/workplace/logic/workplace-materialize-engine.js";
import { WorkplaceFileTree } from "@/domain/workplace/logic/workplace-file-tree.js";
import { WorkplaceRuleEngine } from "@/domain/workplace/logic/workplace-rule-engine.js";
import { WorkplaceScope } from "@/domain/workplace/logic/workplace-scope.js";
import type { SetDirRuleInput, SetFileRuleInput, WorkplaceDirRule, WorkplaceListRow, WorkplaceScope as WorkplaceScopeType } from "@/domain/workplace/model/workplace-types.js";
import type { WorkplaceRuleContext, WorkplaceRuleView } from "@/domain/workplace/model/workplace-rule-view.js";
import type { WorkplaceLiveView, WorkplaceMaterialized, WorkplacePersistBlock, WorkplaceService } from "../workplace.port.js";
import type { SmartRuleRowsProvider, SmartRulesProvider } from "../workplace.port.js";
import { WorkplaceViewCache, type WorkplaceViewCacheValue, type WorkplaceViewSigs } from "./workplace-view-cache.js";

/** Dependencies for {@link DefaultWorkplaceService}. */
interface WorkplaceServiceDeps {
    readonly scope: WorkplaceScopeType;
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
/** 规则表按 logicalPath 的确定性排序比较器（读时校验签名采样用，零捕获纯函数）。 */
const byLogicalPath = (a: { logicalPath: string }, b: { logicalPath: string }): number => {
    if (a.logicalPath < b.logicalPath) {
        return -1;
    }
    if (a.logicalPath > b.logicalPath) {
        return 1;
    }
    return 0;
};

export class DefaultWorkplaceService implements WorkplaceService {
    readonly scope: WorkplaceScopeType;

    constructor(private readonly deps: WorkplaceServiceDeps) {
        this.scope = deps.scope;
    }

    async setDirRule(input: SetDirRuleInput): Promise<Result<void, AppError>> {
        const resolved = PathNormalizer.normalize(input.logicalPath);
        if (!resolved.ok) return Result.err(resolved.error);
        const logicalPath = resolved.value;
        const allowed = LogicalPath.validate(this.scope, logicalPath);
        if (!allowed.ok) return Result.err(allowed.error);
        if (input.ruleEnabled === false && WorkplaceScope.isRootPath(this.scope, logicalPath)) {
            return Result.err(new AppError("WORKPLACE_ROOT_RULE_LOCKED", { detail: "cannot disable rules on root directory" }));
        }
        const existingRule = await this.deps.workplace.findDirRule(WorkplaceScope.key(this.scope), logicalPath);
        if (!existingRule.ok) return Result.err(existingRule.error);
        const existing = existingRule.value;
        // Any save without explicit --rule off enables rules (do not preserve prior rule_off).
        const rule: WorkplaceDirRule = {
            scopeKey: WorkplaceScope.key(this.scope),
            logicalPath,
            ruleEnabled: input.ruleEnabled === false ? false : true,
            sortField: input.sortField ?? existing?.sortField ?? DEFAULT_WORKPLACE_DIR_RULE.sortField,
            sortOrder: input.sortOrder ?? existing?.sortOrder ?? DEFAULT_WORKPLACE_DIR_RULE.sortOrder,
            headCount: input.headCount ?? existing?.headCount ?? DEFAULT_WORKPLACE_DIR_RULE.headCount,
            tailCount: input.tailCount ?? existing?.tailCount ?? DEFAULT_WORKPLACE_DIR_RULE.tailCount,
            fillPolicy: input.fillPolicy ?? existing?.fillPolicy ?? DEFAULT_WORKPLACE_DIR_RULE.fillPolicy,
        };
        const upserted = await this.deps.workplace.upsertDirRule(rule);
        if (!upserted.ok) return Result.err(upserted.error);
        return Result.ok(undefined);
    }

    async getDirRule(logicalPath: string): Promise<Result<WorkplaceDirRule | undefined, AppError>> {
        const resolved = PathNormalizer.normalize(logicalPath);
        if (!resolved.ok) return Result.err(resolved.error);
        const normalized = resolved.value;
        const allowed = LogicalPath.validate(this.scope, normalized);
        if (!allowed.ok) return Result.err(allowed.error);
        const rule = await this.deps.workplace.findDirRule(WorkplaceScope.key(this.scope), normalized);
        if (!rule.ok) return Result.err(rule.error);
        return Result.ok(rule.value ?? undefined);
    }

    async listDirRules(): Promise<WorkplaceDirRule[]> {
        return this.deps.workplace.listDirRules(WorkplaceScope.key(this.scope));
    }

    async setFileRule(input: SetFileRuleInput): Promise<Result<void, AppError>> {
        const resolved = PathNormalizer.normalize(input.logicalPath);
        if (!resolved.ok) return Result.err(resolved.error);
        const logicalPath = resolved.value;
        const allowed = LogicalPath.validate(this.scope, logicalPath);
        if (!allowed.ok) return Result.err(allowed.error);
        const upserted = await this.deps.workplace.upsertFileRule({ scopeKey: WorkplaceScope.key(this.scope), logicalPath, inclusionMode: input.inclusionMode });
        if (!upserted.ok) return Result.err(upserted.error);
        return Result.ok(undefined);
    }

    async deleteRulesUnderLogicalPrefix(logicalPrefix: string): Promise<Result<void, AppError>> {
        const resolved = PathNormalizer.normalize(logicalPrefix);
        if (!resolved.ok) return Result.err(resolved.error);
        const normalized = resolved.value;
        const allowed = LogicalPath.validate(this.scope, normalized);
        if (!allowed.ok) return Result.err(allowed.error);
        const deleted = await this.deps.workplace.deleteRulesUnderLogicalPrefix(WorkplaceScope.key(this.scope), normalized);
        if (!deleted.ok) return Result.err(deleted.error);
        return Result.ok(undefined);
    }

    async renameRulesUnderLogicalPrefix(oldPrefix: string, newPrefix: string): Promise<Result<void, AppError>> {
        const oldResolved = PathNormalizer.normalize(oldPrefix);
        if (!oldResolved.ok) return Result.err(oldResolved.error);
        const newResolved = PathNormalizer.normalize(newPrefix);
        if (!newResolved.ok) return Result.err(newResolved.error);
        const oldNormalized = oldResolved.value;
        const newNormalized = newResolved.value;
        const allowedOld = LogicalPath.validate(this.scope, oldNormalized);
        if (!allowedOld.ok) return Result.err(allowedOld.error);
        const allowedNew = LogicalPath.validate(this.scope, newNormalized);
        if (!allowedNew.ok) return Result.err(allowedNew.error);
        const renamed = await this.deps.workplace.renameRulesUnderLogicalPrefix(WorkplaceScope.key(this.scope), oldNormalized, newNormalized);
        if (!renamed.ok) return Result.err(renamed.error);
        return Result.ok(undefined);
    }

    /** @deprecated 使用 {@link materializeLiveView} / {@link materializePersistBlock}。 */
    async materialize(): Promise<Result<WorkplaceMaterialized, AppError>> {
        const [live, persist] = await Promise.all([this.materializeLiveView(), this.materializePersistBlock()]);
        if (!live.ok) return Result.err(live.error);
        if (!persist.ok) return Result.err(persist.error);
        return Result.ok({
            listRows: live.value.listRows,
            workplaceDisplay: persist.value.workplaceDisplay,
            filetreeDisplay: live.value.filetreeDisplay,
        });
    }

    async materializeLiveView(): Promise<Result<WorkplaceLiveView, AppError>> {
        // 并发去重由 conn 级缓存 entry.inFlight 承接（升级为跨实例，语义等价于
        // 原实例级 liveViewInFlight 的合并行为）。
        const value = await this.evaluateCachedView();
        if (!value.ok) return Result.err(value.error);
        return Result.ok({ listRows: value.value.view.rows, filetreeDisplay: value.value.filetreeDisplay });
    }

    async materializePersistBlock(): Promise<Result<WorkplacePersistBlock, AppError>> {
        const value = await this.evaluateCachedView();
        if (!value.ok) return Result.err(value.error);
        // 缓存命中时复用缓存 ctx 的 mtimeByPath：mtime 变化必然改变 vfs 签名
        // 触发整条重算，读-改-写一致性不受损。
        const workplaceDisplay = await WorkplaceMaterializeEngine.materializeBlockFromView(value.value.view, this.deps.vfs, this.scope, value.value.ctx.mtimeByPath);
        if (!workplaceDisplay.ok) return Result.err(workplaceDisplay.error);
        return Result.ok({ workplaceDisplay: workplaceDisplay.value });
    }

    async evaluateRuleView(): Promise<Result<WorkplaceRuleView, AppError>> {
        const value = await this.evaluateCachedView();
        if (!value.ok) return Result.err(value.error);
        return Result.ok(value.value.view);
    }

    async buildListRows(): Promise<Result<WorkplaceListRow[], AppError>> {
        const live = await this.materializeLiveView();
        if (!live.ok) return Result.err(live.error);
        return Result.ok([...live.value.listRows]);
    }

    /** nm-style: keep-public — WorkplaceService 端口契约方法（workplace.port.ts:102），apps/cli run-workplace 单点消费；内联等于删端口声明。 */
    async renderDisplay(): Promise<Result<string, AppError>> {
        const block = await this.materializePersistBlock();
        if (!block.ok) return Result.err(block.error);
        return Result.ok(block.value.workplaceDisplay);
    }

    async renderFileTree(): Promise<Result<string, AppError>> {
        const live = await this.materializeLiveView();
        if (!live.ok) return Result.err(live.error);
        return Result.ok(live.value.filetreeDisplay);
    }

    /**
   * 读时校验的缓存化评估：采样签名 → 命中直接返回缓存 → 未命中经 entry.inFlight
   * 并发去重计算（loadContextMetadata + evaluate + filetree render）→ 发布时
   * 携带计算**前**采样的 sigs（计算期间有写时下一个读者自愈，脏结果最多存活一次）。
   *
   * 采样口径：vfs 聚合签名（1 条 SQL）+ 规则表全量重读按 logicalPath 排序后的
   * 确定性 JSON 序列化（规则表无版本列且存在同数改写，不做聚合指纹）+
   * smart_sort_rule 全量按 sort_order 排序后的确定性序列化（原始行不编译，
   * core/B-3：增删改/启停/调序智能规则都会反映到签名，改规则后排序即时刷新）。
   */
    private async evaluateCachedView(): Promise<Result<WorkplaceViewCacheValue, AppError>> {
        const conn = this.deps.conn;
        const cacheKey = WorkplaceScope.key(this.scope);
        const vfsKey = LogicalPath.scopeKey(this.scope);
        const vfs = await this.deps.vfs.computeEntrySignature(vfsKey);
        const dirRules = await this.deps.workplace.listDirRules(cacheKey);
        const fileRules = await this.deps.workplace.listFileRules(cacheKey);
        dirRules.sort(byLogicalPath);
        fileRules.sort(byLogicalPath);
        // 无条件采样（表小成本可忽略，管理页改规则低频，过度失效可接受）；
        // listOrdered 已按 sort_order 排序，行对象由 repo 字面量构造，序列化确定。
        const smartRuleRows = this.deps.smartRuleRows != null ? await this.deps.smartRuleRows() : [];
        const sigs: WorkplaceViewSigs = { vfs, rules: JSON.stringify([dirRules, fileRules]), smartRules: JSON.stringify(smartRuleRows) };
        const entry = WorkplaceViewCache.ensureEntry(conn, cacheKey);
        const cached = WorkplaceViewCache.getCached(entry, sigs);
        if (cached != null) return Result.ok(cached);
        if (entry.inFlight != null) return entry.inFlight;
        const computing = (async (): Promise<Result<WorkplaceViewCacheValue, AppError>> => {
            const ctx = await this.loadContextMetadata();
            if (!ctx.ok) return Result.err(ctx.error);
            const evaluated = WorkplaceRuleEngine.evaluateView(this.scope, ctx.value);
            if (!evaluated.ok) return Result.err(evaluated.error);
            const filetree = WorkplaceFileTree.renderForMacro({
                scope: this.scope,
                allDirs: ctx.value.allDirs,
                fileSet: ctx.value.fileSet,
                dirRuleMap: ctx.value.dirRuleMap,
                mtimeByPath: ctx.value.mtimeByPath,
                smartRules: ctx.value.smartRules,
                dirMtimeByPath: ctx.value.dirMtimeByPath,
                displayByPath: evaluated.value.displayByPath,
            });
            if (!filetree.ok) return Result.err(filetree.error);
            return Result.ok({ ctx: ctx.value, view: evaluated.value, filetreeDisplay: filetree.value });
        })();
        entry.inFlight = computing;
        try {
            const value = await computing;
            if (!value.ok) return Result.err(value.error);
            WorkplaceViewCache.publish(conn, cacheKey, sigs, value.value);
            return value;
        } finally {
            if (entry.inFlight === computing) entry.inFlight = undefined;
        }
    }

    /**
   * Loads path/mtime/rules context without scanning file content.
   *
   * nm-style: keep-local — 独立读盘管线：文件/目录/规则/智能规则的查询编排成 WorkplaceRuleContext，
   * 内联进 evaluateCachedView 的 inFlight 闭包会把 IO 阶段与并发去重状态机搅在一起。
   */
    private async loadContextMetadata(): Promise<Result<WorkplaceRuleContext, AppError>> {
        const scopeKey = WorkplaceScope.key(this.scope);
        const vfsKey = LogicalPath.scopeKey(this.scope);
        // entry_id 化后 path 列直接存逻辑路径，整个 scope 列在 "/" 前缀下
        const fileMeta = await this.deps.vfs.listFileMetaUnderPrefix(vfsKey, "/");
        // 目录行查询提前到 buildWorkplaceDirSet 之前：既要喂给 allDirs，也要
        // 作为「目录真实存在」的判据过滤幽灵规则路径（复用同一条 SQL，零新增查询）。
        const dirPaths = await this.deps.vfs.listDirectoryPathsUnderPrefix(vfsKey, "/");
        const dirRules = await this.deps.workplace.listDirRules(scopeKey);
        const fileRules = await this.deps.workplace.listFileRules(scopeKey);
        const dirRuleMap = new Map(dirRules.map((r) => [r.logicalPath, r]));
        const fileRuleMap = new Map(fileRules.map((r) => [r.logicalPath, r]));
        const fileSet = new Set<string>();
        for (const row of fileMeta) {
            const resolved = PathNormalizer.normalize(row.path);
            if (!resolved.ok) return Result.err(resolved.error);
            fileSet.add(resolved.value);
        }
        // VFS 中真实存在的目录行（normalize 后作判据；喂 allDirs 用同一份数据）
        const dirPathSet = new Set<string>();
        for (const logical of dirPaths) {
            const resolved = PathNormalizer.normalize(logical);
            if (!resolved.ok) return Result.err(resolved.error);
            dirPathSet.add(resolved.value);
        }
        // 过滤幽灵规则路径：rename/删除残留的规则路径（VFS 目录行与文件都已不存在）若继续喂给
        // buildWorkplaceDirSet，会把早已消失的目录整链渲染进文件树与 `{{$filetree}}` 宏。保留口径：
        // 根路径 `/` 永远保留；目录规则 P 在 dirPathSet 中、或前缀 `P/` 下仍有 live 文件时保留；
        // 文件规则 P 在 fileSet 中时保留。PathNormalizer.normalize 失败沿 Result 原样上交调用方。
        const keptPaths: string[] = [];
        const files = [...fileSet];
        for (const raw of [...dirRules.map((r) => r.logicalPath), ...fileRules.map((r) => r.logicalPath)]) {
            const resolved = PathNormalizer.normalize(raw);
            if (!resolved.ok) return Result.err(resolved.error);
            const n = resolved.value;
            if (n === "/") {
                keptPaths.push(raw);
                continue;
            }
            const prefix = `${n}/`;
            const asDirKeep = dirRuleMap.has(n) && (dirPathSet.has(n) || files.some((f) => f.startsWith(prefix)));
            const asFileKeep = fileRuleMap.has(n) && fileSet.has(n);
            if (asDirKeep || asFileKeep) keptPaths.push(raw);
        }
        const mtimeByPath = new Map<string, number>();
        for (const row of fileMeta) {
            mtimeByPath.set(row.path, row.mtimeMs);
        }
        const allDirs = WorkplaceTree.buildDirSet({
            scope: this.scope,
            filePaths: [...fileSet],
            configuredPaths: keptPaths,
        });
        if (!allDirs.ok) return Result.err(allDirs.error);
        for (const logical of dirPathSet) {
            allDirs.value.add(logical);
        }
        const dirMtimeByPath = new Map<string, number>();
        for (const row of await this.deps.vfs.listDirectoryMetaUnderPrefix(vfsKey, "/")) {
            dirMtimeByPath.set(row.path, row.mtimeMs);
        }
        // 懒加载（Step 6）：仅当存在 sortField='smart' 的目录规则时才查表编译。
        // 与排序消费端（sortFilesForDir / sortDirPaths）共用同一基线口径——只看
        // sortField、不看 ruleEnabled：disabled 目录规则的排序配置仍生效（与
        // created/updated 的 disabled-仍生效基线对齐），单条规则是否启用由编译
        // 结果决定（disabled 规则不参与编译），不在加载侧预过滤。
        const smartRules = this.deps.smartRules != null && [...dirRuleMap.values()].some((r) => r.sortField === "smart") ? await this.deps.smartRules() : undefined;
        if (smartRules != null && !smartRules.ok) return Result.err(smartRules.error);
        return Result.ok({
            dirRuleMap,
            fileRuleMap,
            fileSet,
            mtimeByPath,
            allDirs: allDirs.value,
            smartRules: smartRules?.value,
            dirMtimeByPath,
        });
    }
}
