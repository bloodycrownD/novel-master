/**
 * SQLite implementation of {@link VfsRevisionRepository}.
 *
 * entry_id 化后所有 SQL 改按 `entry_id` 寻址；前缀扫描经 `vfs_entry` JOIN 用
 * `(scope_key, path)` 圈定范围。
 *
 * @module domain/vfs/repositories/impl/sqlite-vfs-revision.repository
 */

import type {TdbcConnection} from "@/infra/tdbc/ports/connection.port.js";
import {SqlTemplateParser} from "@/infra/sql-template/index.js";
import {TdbcTemplate} from "@/infra/tdbc/logic/template-helper.js";
import {Coerce} from "@/common/coerce.js";
import {SqliteVfsContentStore} from "../../content-store/impl/sqlite-vfs-content-store.js";
import type {VfsContentStore} from "../../content-store/vfs-content-store.port.js";
import {StoredContent} from "../../content-store/logic/resolve-stored-content.js";
import type {VfsRevision, VfsRevisionStatus} from "../../model/vfs-revision.js";
import type {VfsRevisionAppendInput, VfsRevisionPointerMeta, VfsRevisionRepository} from "../vfs-revision.port.js";
import {AppError} from "@/errors/app-error.js";
import {Result} from "@/errors/either.js";
import {RevisionPairKey} from "../../logic/revision-pair-key.js";
import {ScopePrefix} from "./scope-prefix-helpers.js";
import {Path} from "@/common/path.js";
import {VfsRevisionSql} from "@/infra/sql-template/generated/vfs_revision.mapper.generated.js";

/** 批量 SQL 的分块大小（避免单条语句过长）。 */
const REVISION_BATCH_CHUNK_SIZE = 100;

/** batchRepairRefCountFloor 的 SELECT / UPDATE 分块大小（对齐 v1.4.24 的 500）。 */
const REVISION_REPAIR_CHUNK_SIZE = 500;

/**
 * TDBC-backed vfs_revision repository（append-only；正文经 ContentStore）。
 */

export class SqliteVfsRevisionRepository implements VfsRevisionRepository {
    private readonly parser = new SqlTemplateParser();
    private readonly contentStore: VfsContentStore;

    constructor(private readonly conn: TdbcConnection, contentStore?: VfsContentStore) {
        this.contentStore = contentStore ?? new SqliteVfsContentStore(conn);
    }

    async findMaxVersionForEntry(entryId: number): Promise<number | null> {
        const rows = await TdbcTemplate.query<{
            max_version: number | null
        }>(this.conn, this.parser, VfsRevisionSql.findMaxVersionForEntry, {entryId});
        const max = rows[0]?.max_version;
        return max == null ? null : Number(max);
    }

    /** nm-style: keep-public — 实现 VfsRevisionRepository.findMaxVersionsForEntries 端口方法；内联会把分块聚合 SQL 搬进调用层。 */
    async findMaxVersionsForEntries(entryIds: number[]): Promise<Map<number, number>> {
        const result = new Map<number, number>();
        if (entryIds.length === 0) {
            return result;
        }
        for (let offset = 0; offset < entryIds.length; offset += REVISION_BATCH_CHUNK_SIZE) {
            const chunk = entryIds.slice(offset, offset + REVISION_BATCH_CHUNK_SIZE);
            const rows = await TdbcTemplate.query<{ entry_id: number; max_version: number }>(this.conn, this.parser, VfsRevisionSql.findMaxVersionsForEntries, {entryIds: chunk});
            for (const row of rows) {
                result.set(Number(row.entry_id), Number(row.max_version));
            }
        }
        return result;
    }

    async findByEntryAndVersion(entryId: number, version: number): Promise<Result<VfsRevision | null, AppError>> {
        const rows = await TdbcTemplate.query(this.conn, this.parser, VfsRevisionSql.findByEntryAndVersion, {entryId, version});
        if (rows.length === 0) {
            return Result.ok(null);
        }
        const row = rows[0]!;
        const statusRaw = String(row.status);
        const status: VfsRevisionStatus = statusRaw === "deleted" ? "deleted" : "active";
        const resolved = await StoredContent.resolveRevision(this.contentStore, {status, content: null, contentHash: Coerce.nullableText(row.content_hash)});
        if (!resolved.ok) return Result.err(resolved.error);
        return Result.ok({entryId: Number(row.entry_id), version: Number(row.version), content: resolved.value, status, mtimeMs: Number(row.mtime_ms),});
    }

    /** nm-style: keep-public — 实现 VfsRevisionRepository.existsByEntryAndVersion 端口方法；内联会把查询 SQL 搬进调用层。 */
    async existsByEntryAndVersion(entryId: number, version: number): Promise<boolean> {
        const rows = await TdbcTemplate.query<{
            one: number
        }>(this.conn, this.parser, VfsRevisionSql.existsByEntryAndVersion, {entryId, version});
        return rows.length > 0;
    }

    async findMetaByEntryAndVersion(entryId: number, version: number): Promise<VfsRevisionPointerMeta | null> {
        const rows = await TdbcTemplate.query<{ status: string; content_hash: string | null }>(this.conn, this.parser, VfsRevisionSql.findMetaByEntryAndVersion, {entryId, version});
        const row = rows[0];
        if (row == null) {
            return null;
        }
        return {status: row.status as VfsRevisionStatus, contentHash: Coerce.nullableText(row.content_hash),};
    }

    async findMetasByEntryVersions(pairs: ReadonlyArray<{
        readonly entryId: number;
        readonly version: number
    }>): Promise<Map<string, VfsRevisionPointerMeta>> {
        const result = new Map<string, VfsRevisionPointerMeta>();
        if (pairs.length === 0) {
            return result;
        }
        for (let offset = 0; offset < pairs.length; offset += REVISION_BATCH_CHUNK_SIZE) {
            const chunk = pairs.slice(offset, offset + REVISION_BATCH_CHUNK_SIZE);
            const rows = await TdbcTemplate.query<{ entry_id: number; version: number; status: string; content_hash: string | null }>(this.conn, this.parser, VfsRevisionSql.findMetasByEntryVersions, {pairs: chunk});
            for (const row of rows) {
                result.set(RevisionPairKey.build(Number(row.entry_id), Number(row.version)), {status: row.status as VfsRevisionStatus, contentHash: Coerce.nullableText(row.content_hash),});
            }
        }
        return result;
    }

    async findExistingEntryVersionKeys(pairs: ReadonlyArray<{ readonly entryId: number; readonly version: number }>): Promise<Set<string>> {
        const result = new Set<string>();
        if (pairs.length === 0) {
            return result;
        }
        const CHUNK_SIZE = 500;
        for (let offset = 0; offset < pairs.length; offset += CHUNK_SIZE) {
            const chunk = pairs.slice(offset, offset + CHUNK_SIZE);
            const rows = await TdbcTemplate.query<{ entry_id: number; version: number }>(this.conn, this.parser, VfsRevisionSql.findExistingEntryVersionKeys, {pairs: chunk});
            for (const row of rows) {
                result.add(RevisionPairKey.build(Number(row.entry_id), Number(row.version)));
            }
        }
        return result;
    }

    async batchAppendWithRefCount(items: ReadonlyArray<{
        readonly entryId: number;
        readonly version: number;
        readonly contentHash: string | null;
        readonly status: string;
        readonly mtimeMs: number;
        readonly refCount: number;
    }>): Promise<void> {
        if (items.length === 0) return;
        const paramsList = items.map((i) => [i.entryId, i.version, i.contentHash, i.status, i.mtimeMs, i.refCount]);
        await this.conn.batch(VfsRevisionSql.batchAppendWithRefCount, paramsList);
    }

    async append(input: VfsRevisionAppendInput): Promise<void> {
        let contentHash: string | null = null;
        if (input.status === "active") {
            if (input.contentHash != null && input.contentHash.length > 0) {
                contentHash = input.contentHash;
            } else if (input.content != null) {
                contentHash = await this.contentStore.put(input.content);
            }
        }

        await TdbcTemplate.execute(this.conn, this.parser, VfsRevisionSql.append, {entryId: input.entryId, version: input.version, contentHash, status: input.status, mtimeMs: input.mtimeMs,});
    }

    /** nm-style: keep-public — 实现 VfsRevisionRepository.listKeysUnderScope 端口方法；唯一生产调用来自同类 deleteExceptReachable（同为端口方法），内联会在调用点复制 JOIN 扫描 SQL，且端口仍要求此方法存在。 */
    async listKeysUnderScope(scopeKey: string, pathPrefix: string): Promise<ReadonlyArray<{
        entryId: number;
        version: number
    }>> {
        const base = Path.stripTrailingSlash(pathPrefix);
        const escaped = ScopePrefix.escapeLike(base);
        const pattern = base === "/" ? "/%" : `${escaped}/%`;
        const rows = await TdbcTemplate.query<{ entry_id: number; version: number }>(this.conn, this.parser, VfsRevisionSql.listKeysUnderScope, {scopeKey, path: base, pattern});
        return rows.map((row) => ({entryId: Number(row.entry_id), version: Number(row.version),}));
    }

    /** nm-style: keep-public — 实现 VfsRevisionRepository.listKeysWithRefCountUnderScope 端口方法；内联会把 JOIN 扫描 SQL 搬进调用层。 */
    async listKeysWithRefCountUnderScope(scopeKey: string, pathPrefix: string): Promise<ReadonlyArray<{ entryId: number; version: number; refCount: number }>> {
        const base = Path.stripTrailingSlash(pathPrefix);
        const escaped = ScopePrefix.escapeLike(base);
        const pattern = base === "/" ? "/%" : `${escaped}/%`;
        const rows = await TdbcTemplate.query<{ entry_id: number; version: number; ref_count: number }>(this.conn, this.parser, VfsRevisionSql.listKeysWithRefCountUnderScope, {scopeKey, path: base, pattern});
        return rows.map((row) => ({entryId: Number(row.entry_id), version: Number(row.version), refCount: Number(row.ref_count),}));
    }

    /** nm-style: keep-public — 实现 VfsRevisionRepository.deleteExceptReachable 端口方法；可达集 fallback 已退役（revision-gc.ts），生产零调用，但端口契约仍在且端口文件不在本轮范围，测试经端口直接覆盖。 */
    async deleteExceptReachable(scopeKey: string, pathPrefix: string, reachable: ReadonlySet<string>): Promise<number> {
        const candidates = await this.listKeysUnderScope(scopeKey, pathPrefix);
        const toDelete = candidates.filter(({entryId, version}) => !reachable.has(RevisionPairKey.build(entryId, version)));
        if (toDelete.length === 0) {
            return 0;
        }
        let deleted = 0;
        for (let offset = 0; offset < toDelete.length; offset += REVISION_BATCH_CHUNK_SIZE) {
            const chunk = toDelete.slice(offset, offset + REVISION_BATCH_CHUNK_SIZE);
            await TdbcTemplate.execute(this.conn, this.parser, VfsRevisionSql.deleteExceptReachable, {pairs: chunk});
            deleted += chunk.length;
        }
        return deleted;
    }

    /** nm-style: keep-public — 实现 VfsRevisionRepository.adjustRefCount 端口方法；内联会把 ref_count 增减 SQL 搬进调用层。 */
    async adjustRefCount(entryId: number, version: number, delta: number): Promise<void> {
        if (delta === 0) {
            return;
        }
        const result = await TdbcTemplate.execute(this.conn, this.parser, VfsRevisionSql.adjustRefCount, {entryId, version, delta});
        if (delta > 0 && result.changes === 0) {
            // 记录缺失而非路径缺失，无 path 可挂；走旧签名过渡保 details 一层形态（与旧 VfsError 一致）。
            // nm-throw: keep — port 契约锁定：vfs-revision.port.ts adjustRefCount 声明 Promise<void> 且 @throws
            // 明文守护 T-RB-REF-MISSING 不变量；改 Result 需动 port 与全部调用方（跨分片），登记待办。
            throw new AppError("VFS_NOT_FOUND", {detail: `Revision not found: entry ${entryId}@${version}`, entryId, version});
        }
    }

    async batchAdjustRefCount(pointers: ReadonlyArray<{ readonly entryId: number; readonly version: number }>, delta: 1 | -1): Promise<void> {
        await this.batchAdjustRefCountWithDelta(pointers, delta);
    }

    async batchAdjustRefCountWithDelta(pointers: ReadonlyArray<{ readonly entryId: number; readonly version: number }>, delta: number): Promise<void> {
        if (pointers.length === 0 || delta === 0) {
            return;
        }

        // delta > 0 要先校验所有 pair 都存在，守护 T-RB-REF-MISSING 不变量；
        // delta < 0 命不中即跳过，不需要前置查存在性（但 UPDATE 侧带下限夹逼，
        // 见下方 clamp）。
        if (delta > 0) {
            const existing = await this.findExistingEntryVersionKeys(pointers);
            const missing: Array<{ entryId: number; version: number }> = [];
            for (const p of pointers) {
                if (!existing.has(RevisionPairKey.build(p.entryId, p.version))) {
                    missing.push({entryId: p.entryId, version: p.version});
                }
            }
            if (missing.length > 0) {
                const first = missing[0]!;
                // nm-throw: keep — port 契约锁定：vfs-revision.port.ts batchAdjustRefCount(WithDelta) 的 @throws 契约
                // 同款（批量前置存在性校验，守护 T-RB-REF-MISSING）；改 Result 需动 port 与调用方（跨分片）。
                throw new AppError("VFS_NOT_FOUND", {detail: `Revision not found: entry ${first.entryId}@${first.version} （共 ${missing.length} 条缺失）`, missing});
            }
        }

        // 按 500 分块发 UPDATE，复用 findExistingEntryVersionKeys 的 (entry_id, version) IN (...) 写法
        const CHUNK_SIZE = 500;
        // 分支标志与 |delta| 在 JS 侧算好：正向累加 / 负向累减，负向再加下限夹逼（D15）。
        // delta < 0 的下限夹逼：`ref_count` 误减会把计数打到负数，而负数与
        // 0 在 `deleteUnreferencedUnderScope`（`ref_count <= 0` 判删）眼里一样是
        // 「无持有者」——误减活 revision 是不可恢复方向。夹逼**必须按 |delta| 量级**
        // （前值不足时 UPDATE 命不中 → 计数保持原样）。
        const positive = delta > 0;
        const negative = delta < 0;
        const absDelta = Math.abs(delta);
        for (let offset = 0; offset < pointers.length; offset += CHUNK_SIZE) {
            const chunk = pointers.slice(offset, offset + CHUNK_SIZE);
            await TdbcTemplate.execute(this.conn, this.parser, VfsRevisionSql.batchAdjustRefCountWithDelta, {positive, negative, delta, absDelta, pointers: chunk});
        }
    }

    /** nm-style: keep-public — 实现 VfsRevisionRepository.repairRefCountFloor 端口方法；integrity-repair 注明保留逐条版，生产对账走 batchRepairRefCountFloor，端口契约仍在且端口文件不在本轮范围。 */
    async repairRefCountFloor(entryId: number, version: number, expected: number): Promise<boolean> {
        const rows = await TdbcTemplate.query<{
            ref_count: number
        }>(this.conn, this.parser, VfsRevisionSql.repairRefCountFloorSelect, {entryId, version});
        const row = rows[0];
        if (row == null) {
            return false;
        }
        const current = Number(row.ref_count);
        if (current >= expected) {
            return false;
        }
        await TdbcTemplate.execute(this.conn, this.parser, VfsRevisionSql.repairRefCountFloor, {entryId, version, expected});
        return true;
    }

    /** nm-style: keep-public — 实现 VfsRevisionRepository.batchRepairRefCountFloor 端口方法；内联会把分块 SELECT + batch UPDATE 搬进调用层。 */
    async batchRepairRefCountFloor(items: ReadonlyArray<{ readonly entryId: number; readonly version: number; readonly expected: number; }>): Promise<number> {
        if (items.length === 0) {
            return 0;
        }

        // Step 1：批量 SELECT 当前 ref_count。复用 (entry_id, version) IN (...) 写法，
        // 按 500 分块避免单条 SQL 太长。缺失行（revision 已被 GC）自然不会进 currentMap，
        // 后面 diff 时当作 no-op，跟逐条 repairRefCountFloor 的 row == null 分支一致。
        const currentMap = new Map<string, number>();
        for (let offset = 0; offset < items.length; offset += REVISION_REPAIR_CHUNK_SIZE) {
            const chunk = items.slice(offset, offset + REVISION_REPAIR_CHUNK_SIZE);
            const rows = await TdbcTemplate.query<{ entry_id: number; version: number; ref_count: number }>(this.conn, this.parser, VfsRevisionSql.batchRepairRefCountFloorSelect, {pairs: chunk});
            for (const row of rows) {
                currentMap.set(RevisionPairKey.build(Number(row.entry_id), Number(row.version)), Number(row.ref_count));
            }
        }

        // Step 2：内存算 diff，只挑 current < expected 的项（保持「只增不减」语义）。
        const toUpdate: Array<[number, number, number]> = [];
        for (const item of items) {
            const current = currentMap.get(RevisionPairKey.build(item.entryId, item.version));
            if (current == null) {
                continue;
            }
            if (current < item.expected) {
                toUpdate.push([item.expected, item.entryId, item.version]);
            }
        }
        if (toUpdate.length === 0) {
            return 0;
        }

        // Step 3：conn.batch 写回。每条参数是 [expected, entryId, version]，对应
        // `UPDATE ... SET ref_count = ? WHERE entry_id = ? AND version = ?`。batch 把
        // N 行压成一次原生调用，counter 侧只计 1 条 SQL（同文本）。同样按 500 分块，
        // 避免单次 batch 参数列表过长。
        let adjusted = 0;
        for (let offset = 0; offset < toUpdate.length; offset += REVISION_REPAIR_CHUNK_SIZE) {
            const chunk = toUpdate.slice(offset, offset + REVISION_REPAIR_CHUNK_SIZE);
            await this.conn.batch(VfsRevisionSql.batchRepairRefCountFloor, chunk);
            adjusted += chunk.length;
        }
        return adjusted;
    }

    /** nm-style: keep-public — 实现 VfsRevisionRepository.deleteUnreferencedUnderScope 端口方法；内联会把 COUNT + 子查询 DELETE 搬进调用层。 */
    async deleteUnreferencedUnderScope(scopeKey: string, pathPrefix: string, excludePrefixes?: readonly string[]): Promise<number> {
        const base = Path.stripTrailingSlash(pathPrefix);
        const escaped = ScopePrefix.escapeLike(base);
        const pattern = base === "/" ? "/%" : `${escaped}/%`;
        // 隔离豁免：排除前缀下的 revision 不参与 GC（NOT (path = excl OR path LIKE excl/%)）
        const excludes = excludePrefixes ?? [];
        const excludeParams = excludes.map((exclRaw) => {
            const excl = Path.stripTrailingSlash(exclRaw.startsWith("/") ? exclRaw : `/${exclRaw}`);
            return {path: excl, pattern: `${ScopePrefix.escapeLike(excl)}/%`};
        });
        const bindings = {scopeKey, path: base, pattern, hasExcludes: excludeParams.length > 0, excludes: excludeParams,};
        const before = await TdbcTemplate.query<{ n: number }>(this.conn, this.parser, VfsRevisionSql.deleteUnreferencedUnderScopeCount, bindings);
        const count = Number(before[0]?.n ?? 0);
        if (count === 0) {
            return 0;
        }
        // 用复合 PK (entry_id, version) 寻址而非 rowid，这样 vfs_revision 可以安全地
        // 切换到 WITHOUT ROWID（决策 4）。rowid 表和 WITHOUT ROWID 表都支持这种写法，
        // 所以这条改动本身不改变 rowid 表上的行为。
        await TdbcTemplate.execute(this.conn, this.parser, VfsRevisionSql.deleteUnreferencedUnderScope, bindings);
        return count;
    }

    async deleteGlobalOrphans(): Promise<number> {
        // 不依赖 vfs_entry JOIN（孤儿 revision 的 entry 已删，JOIN 不到），
        // 直接按「ref_count<=0 且 entry_id 不存在」全表清扫。
        // revision DELETE 触发器会连带维护 vfs_content_blob.ref_count 并回收归零 blob。
        // 语句与语义见 vfs-revision.mapper.xml 的 deleteGlobalOrphans（migration 退役后运行期独占）。
        const result = await TdbcTemplate.execute(this.conn, this.parser, VfsRevisionSql.deleteGlobalOrphans, {});
        return Number(result.changes);
    }
}
