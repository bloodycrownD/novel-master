/**
 * vfs_revision.ref_count 维护辅助（checkpoint 指针 + live head）。
 *
 * entry_id 化后全部按 `entryId` 寻址：checkpoint 行已存 entry_id，live head 扫描返回
 * entry_id。前缀打扫按 `(scopeKey, pathPrefix)` 经 revision repo 的 scope 扫描圈定。
 *
 * @module domain/vfs/logic/revision-ref-count
 */

import type { MessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/message-checkpoint.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import type {
  IntegrityRepairOperation,
} from "@/service/integrity-repair.js";

/** checkpoint 文件指针（entry_id 形态）。 */
export type CheckpointFilePointer = {
  readonly entryId: number;
  readonly revisionVersion: number;
};

/** repairRefCounts 报告。 */
export type RepairReport = {
  readonly rowsAdjusted: number;
  readonly rowsExamined: number;
};

/** 单条 (entryId, version) ±1。 */
export async function adjustRef(
  revisionRepo: VfsRevisionRepository,
  entryId: number,
  version: number,
  delta: 1 | -1,
): Promise<void> {
  await revisionRepo.adjustRefCount(entryId, version, delta);
}

/** live head 从旧版转移到新版（write bump / resetHead）。 */
export async function transferLiveRef(
  revisionRepo: VfsRevisionRepository,
  entryId: number,
  fromVersion: number,
  toVersion: number,
): Promise<void> {
  if (fromVersion === toVersion) {
    return;
  }
  await adjustRef(revisionRepo, entryId, fromVersion, -1);
  await adjustRef(revisionRepo, entryId, toVersion, +1);
}

/** checkpoint_file 行列表 → 每条 (entryId, version) +1。 */
export async function incrementRefsForCheckpointFiles(
  revisionRepo: VfsRevisionRepository,
  files: ReadonlyArray<CheckpointFilePointer>,
): Promise<void> {
  // 走批量 +1，缺失行会报 NOT_FOUND（守护 T-RB-REF-MISSING），跟原来的逐条语义一致
  await revisionRepo.batchAdjustRefCount(
    files.map((f) => ({ entryId: f.entryId, version: f.revisionVersion })),
    +1,
  );
}

/** checkpoint_file 行列表 → 每条 (entryId, version) −1。 */
export async function decrementRefsForCheckpointFiles(
  revisionRepo: VfsRevisionRepository,
  files: ReadonlyArray<CheckpointFilePointer>,
): Promise<void> {
  // 减引用时缺失行 no-op（UPDATE 命不中即跳过），所以不需要前置校验
  await revisionRepo.batchAdjustRefCount(
    files.map((f) => ({ entryId: f.entryId, version: f.revisionVersion })),
    -1,
  );
}

/** 前缀打扫：scope + path 前缀下 DELETE ref_count<=0 的 revision 行。 */
export async function deleteUnreferencedUnderScope(
  revisionRepo: VfsRevisionRepository,
  scopeKey: string,
  pathPrefix: string,
): Promise<number> {
  return revisionRepo.deleteUnreferencedUnderScope(scopeKey, pathPrefix);
}

/**
 * 空闲校验：重算 checkpoint 行数 + live head，只上调 ref_count（禁止因偏低误删）。
 *
 * @remarks 可对任意 scope 调用；bootstrap W3 作为全局 template 兜底以 (global, /)
 * 触发，只覆盖 global scope，session/project 靠 migration 保留 ref_count。
 */
export async function repairRefCounts(
  revisionRepo: VfsRevisionRepository,
  entryRepo: VfsEntryRepository,
  checkpoints: MessageCheckpointRepository,
  scopeKey: string,
  pathPrefix: string,
  sessionId: string,
): Promise<RepairReport> {
  const expected = new Map<string, number>();

  const bump = (entryId: number, version: number): void => {
    const key = `${entryId}:${version}`;
    expected.set(key, (expected.get(key) ?? 0) + 1);
  };

  const pointers = await checkpoints.listFilePointersForSession(sessionId);
  for (const pointer of pointers) {
    bump(pointer.entryId, pointer.revisionVersion);
  }

  const liveHeads = await entryRepo.listFileHeadsUnderPrefix(scopeKey, pathPrefix);
  for (const head of liveHeads) {
    bump(head.entryId, head.headVersion);
  }

  let rowsAdjusted = 0;
  const keys = await revisionRepo.listKeysUnderScope(scopeKey, pathPrefix);
  for (const { entryId, version } of keys) {
    const key = `${entryId}:${version}`;
    const want = expected.get(key) ?? 0;
    const adjusted = await revisionRepo.repairRefCountFloor(entryId, version, want);
    if (adjusted) {
      rowsAdjusted++;
    }
  }

  return { rowsAdjusted, rowsExamined: keys.length };
}

/**
 * 把 {@link repairRefCounts} 包成 `repair` 类型的 {@link IntegrityRepairOperation}。
 *
 * detect 只读地扫一眼 scope 下有没有 revision 行：有的话保守地标记 needsRepair=true，
 * 具体偏差交给幂等的 repair 自己处理（`repairRefCountFloor` 只增不减，重复跑安全）。
 *
 * 注意：这条路径只动 `vfs_revision.ref_count`，**完全不碰** `vfs_content_blob.ref_count`
 * ——后者由 SQLite 触发器在 revision INSERT/DELETE/UPDATE OF content_hash 时维护。
 * `repairRefCountFloor` 只更新 `ref_count` 列、不改 `content_hash`，触发器不会 fire，
 * 所以应用层修复和触发器维护两条路径不会重复计数（T-SC5 守护的不变量）。
 */
export function createRevisionRefCountRepairOperation(args: {
  readonly revisionRepo: VfsRevisionRepository;
  readonly entryRepo: VfsEntryRepository;
  readonly checkpoints: MessageCheckpointRepository;
  readonly scopeKey: string;
  readonly pathPrefix: string;
  readonly sessionId: string;
}): IntegrityRepairOperation {
  const { revisionRepo, entryRepo, checkpoints, scopeKey, pathPrefix, sessionId } =
    args;
  const name = `vfs-revision-ref-count:${scopeKey}:${pathPrefix || "/"}`;
  return {
    name,
    kind: "repair",
    async detect() {
      const keys = await revisionRepo.listKeysUnderScope(scopeKey, pathPrefix);
      if (keys.length === 0) {
        return { needsRepair: false };
      }
      return {
        needsRepair: true,
        details: `scope=${scopeKey} prefix=${pathPrefix || "/"} 下有 ${keys.length} 条 revision 行，交给幂等 repair 兜底`,
      };
    },
    async repair() {
      await repairRefCounts(
        revisionRepo,
        entryRepo,
        checkpoints,
        scopeKey,
        pathPrefix,
        sessionId,
      );
    },
  };
}

/** scope + path 前缀下全部 live file head 批量 −1（会话删除 Step 2）。 */
export async function decrementLiveRefsUnderScope(
  revisionRepo: VfsRevisionRepository,
  entryRepo: VfsEntryRepository,
  scopeKey: string,
  pathPrefix: string,
): Promise<void> {
  const liveHeads = await entryRepo.listFileHeadsUnderPrefix(scopeKey, pathPrefix);
  // 批量减引用，避免对每个 live head 发一条 SQL（会话删除场景下文件多会卡）
  await revisionRepo.batchAdjustRefCount(
    liveHeads.map((h) => ({ entryId: h.entryId, version: h.headVersion })),
    -1,
  );
}
