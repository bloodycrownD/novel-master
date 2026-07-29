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
  for (const file of files) {
    await adjustRef(revisionRepo, file.entryId, file.revisionVersion, +1);
  }
}

/** checkpoint_file 行列表 → 每条 (entryId, version) −1。 */
export async function decrementRefsForCheckpointFiles(
  revisionRepo: VfsRevisionRepository,
  files: ReadonlyArray<CheckpointFilePointer>,
): Promise<void> {
  for (const file of files) {
    await adjustRef(revisionRepo, file.entryId, file.revisionVersion, -1);
  }
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
 * @remarks 仅适用于 session scope。
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

/** scope + path 前缀下全部 live file head 批量 −1（会话删除 Step 2）。 */
export async function decrementLiveRefsUnderScope(
  revisionRepo: VfsRevisionRepository,
  entryRepo: VfsEntryRepository,
  scopeKey: string,
  pathPrefix: string,
): Promise<void> {
  const liveHeads = await entryRepo.listFileHeadsUnderPrefix(scopeKey, pathPrefix);
  for (const head of liveHeads) {
    await adjustRef(revisionRepo, head.entryId, head.headVersion, -1);
  }
}
