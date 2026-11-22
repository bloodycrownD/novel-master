/**
 * vfs_revision.ref_count 维护辅助（checkpoint 指针 + live head）。
 *
 * entry_id 化后全部按 `entryId` 寻址：checkpoint 行已存 entry_id，live head 扫描返回
 * entry_id。前缀打扫按 `(scopeKey, pathPrefix)` 经 revision repo 的 scope 扫描圈定。
 *
 * read 引用（read-tool-result-ref，第三类持有者：消息 tool_result 块的
 * `contentRef` 按全局键 `(entryId, version)` 跨会话指向源 revision）已随
 * E1 清理版退役（v1.5.40 同批：真实库 contentRef 谓词归零 + KKV
 * unrefDone 已置，回迁任务完成使命）：collectReadRefs / aggregateReadRefs /
 * aggregateReadRefPointers / adjustReadRefCount /
 * aggregateReadRefsFromAllMessages 与五路径 ±1 挂点一并删除，repair 期望值
 * 降回两类（checkpoint 指针 + live head）。
 *
 * @module domain/vfs/logic/revision-ref-count
 */

import type { MessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/message-checkpoint.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import { VfsExcludePrefixes } from "./vfs-exclude-prefixes.js";

/** checkpoint 文件指针（entry_id 形态）。 */
export type CheckpointFilePointer = {
    readonly entryId: number;
    readonly revisionVersion: number;
};

/**
 * repair 期望值超出当前 `ref_count` 的行（疑似泄漏——如 checkpoint +1 已
 * 发生但消息未落库即崩溃）。**只报告不自动修**：只增不减哲学下泄漏可检测、
 * 误删不可恢复，方向性选择宁多不少。
 */
type OverExpectedRefRow = {
    readonly entryId: number;
    readonly version: number;
    /** 当前库里的 ref_count。 */
    readonly current: number;
    /** 两类持有者期望值之和（checkpoint 指针 + live head）。 */
    readonly expected: number;
};

/** repair 报告。 */
type RepairReport = {
    readonly rowsAdjusted: number;
    readonly rowsExamined: number;
    /** 期望值两类化后检出的偏高泄漏行（只报告，不自动修）。 */
    readonly overExpected: ReadonlyArray<OverExpectedRefRow>;
};

/** repair 期望值累加：按 (entryId, version) 键 +1（checkpoint 指针与 live head 两类持有者共用）。 */
const bumpExpected = (expected: Map<string, number>, entryId: number, version: number): void => {
    const key = `${entryId}:${version}`;
    expected.set(key, (expected.get(key) ?? 0) + 1);
};

export const RevisionRefCount = {
    /** 单条 (entryId, version) ±1。 */
    async adjust(revisionRepo: VfsRevisionRepository, entryId: number, version: number, delta: 1 | -1): Promise<void> {
        await revisionRepo.adjustRefCount(entryId, version, delta);
    },

    /** live head 从旧版转移到新版（write bump / resetHead）。 */
    async transferLive(revisionRepo: VfsRevisionRepository, entryId: number, fromVersion: number, toVersion: number): Promise<void> {
        if (fromVersion === toVersion) {
            return;
        }
        await RevisionRefCount.adjust(revisionRepo, entryId, fromVersion, -1);
        await RevisionRefCount.adjust(revisionRepo, entryId, toVersion, +1);
    },

    /** checkpoint_file 行列表 → 每条 (entryId, version) +1。 */
    async incrementForCheckpointFiles(revisionRepo: VfsRevisionRepository, files: ReadonlyArray<CheckpointFilePointer>): Promise<void> {
        // 走批量 +1，缺失行会报 NOT_FOUND（守护 T-RB-REF-MISSING），跟原来的逐条语义一致
        const pointers = files.map((f) => ({ entryId: f.entryId, version: f.revisionVersion }));
        await revisionRepo.batchAdjustRefCount(pointers, +1);
    },

    /** checkpoint_file 行列表 → 每条 (entryId, version) −1。 */
    async decrementForCheckpointFiles(revisionRepo: VfsRevisionRepository, files: ReadonlyArray<CheckpointFilePointer>): Promise<void> {
        // 减引用时缺失行 no-op（UPDATE 命不中即跳过），所以不需要前置校验
        const pointers = files.map((f) => ({ entryId: f.entryId, version: f.revisionVersion }));
        await revisionRepo.batchAdjustRefCount(pointers, -1);
    },

    /** 前缀打扫：scope + path 前缀下 DELETE ref_count<=0 的 revision 行。
   *
   * `excludePrefixes` 非空时，排除前缀下的 revision 不参与 GC（隔离豁免）。 */
    async deleteUnreferencedUnderScope(revisionRepo: VfsRevisionRepository, scopeKey: string, pathPrefix: string, excludePrefixes?: readonly string[]): Promise<number> {
        return revisionRepo.deleteUnreferencedUnderScope(scopeKey, pathPrefix, excludePrefixes);
    },

    /**
   * 空闲校验：重算 checkpoint 行数 + live head（两类持有者），只上调
   * ref_count（禁止因偏低误删）；偏高（疑似泄漏）只报告。
   *
   * @remarks 可对任意 scope 调用；bootstrap W3 作为全局 template 兜底以 (global, /)
   * 触发，只覆盖 global scope，session/project 靠 migration 保留 ref_count。
   */
    async repair(revisionRepo: VfsRevisionRepository, entryRepo: VfsEntryRepository, checkpoints: MessageCheckpointRepository, scopeKey: string, pathPrefix: string, sessionId: string): Promise<RepairReport> {
        const expected = new Map<string, number>();

        // 持有者一：checkpoint 文件指针。
        const pointers = await checkpoints.listFilePointersForSession(sessionId);
        for (const pointer of pointers) {
            bumpExpected(expected, pointer.entryId, pointer.revisionVersion);
        }

        // 持有者二：live head。
        const liveHeads = await entryRepo.listFileHeadsUnderPrefix(scopeKey, pathPrefix);
        for (const head of liveHeads) {
            bumpExpected(expected, head.entryId, head.headVersion);
        }

        // 带回当前 ref_count 一次取齐：偏低走 floor 上调，偏高只报告。
        const rows = await revisionRepo.listKeysWithRefCountUnderScope(scopeKey, pathPrefix);
        // 批量化：以前是逐条 repairRefCountFloor（每条 1 SELECT + 1 UPDATE），
        // 200 revision 会发 200 + 200 条 SQL。现在一次性把所有 (entryId, version, expected)
        // 丢给 batchRepairRefCountFloor，它内部按 500 分块批量 SELECT + conn.batch UPDATE，
        // round-trip 数从 2N 压成 ceil(N/500) × 2。
        const items = rows.map(({ entryId, version }) => ({
            entryId,
            version,
            expected: expected.get(`${entryId}:${version}`) ?? 0,
        }));
        const rowsAdjusted = await revisionRepo.batchRepairRefCountFloor(items);

        // 偏高泄漏检测（T-RR13）：ref_count 超过两类期望值之和——不自动修
        //（只增不减：泄漏方向可接受，误删不可恢复），交给报告方决定处置。
        const overExpected = rows
            .filter((row) => row.refCount > (expected.get(`${row.entryId}:${row.version}`) ?? 0))
            .map((row) => ({
                entryId: row.entryId,
                version: row.version,
                current: row.refCount,
                expected: expected.get(`${row.entryId}:${row.version}`) ?? 0,
            }));

        return { rowsAdjusted, rowsExamined: rows.length, overExpected };
    },

    /** scope + path 前缀下全部 live file head 批量 −1（会话删除 Step 2）。
   *
   * `excludePrefixes` 非空时，排除前缀下的 live head 引用不减（隔离豁免）。 */
    async decrementLiveUnderScope(revisionRepo: VfsRevisionRepository, entryRepo: VfsEntryRepository, scopeKey: string, pathPrefix: string, excludePrefixes?: readonly string[]): Promise<void> {
        const excludes = excludePrefixes ?? [];
        const liveHeads = await entryRepo.listFileHeadsUnderPrefix(scopeKey, pathPrefix);
        // 批量减引用，避免对每个 live head 发一条 SQL（会话删除场景下文件多会卡）
        const pointers = liveHeads.filter((h) => !VfsExcludePrefixes.isPathExcluded(h.path, excludes)).map((h) => ({ entryId: h.entryId, version: h.headVersion }));
        await revisionRepo.batchAdjustRefCount(pointers, -1);
    },
} as const;
