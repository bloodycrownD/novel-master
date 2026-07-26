/**
 * vfs_revision.ref_count 维护辅助（checkpoint 指针 + live head）。
 *
 * @module domain/vfs/logic/revision-ref-count
 */

import type { MessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/message-checkpoint.port.js";
import {
  scopePhysicalPrefix,
  toPhysicalPath,
  type VfsScope,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";

/** checkpoint 文件指针（logical → physical 转换用）。 */
export type CheckpointFilePointer = {
  readonly logicalPath: string;
  readonly revisionVersion: number;
};

/** repairRefCounts 报告。 */
export type RepairReport = {
  readonly rowsAdjusted: number;
  readonly rowsExamined: number;
};

/** 单条 (path, version) ±1。 */
export async function adjustRef(
  revisionRepo: VfsRevisionRepository,
  path: string,
  version: number,
  delta: 1 | -1,
): Promise<void> {
  await revisionRepo.adjustRefCount(path, version, delta);
}

/** live head 从旧版转移到新版（write bump / resetHead）。 */
export async function transferLiveRef(
  revisionRepo: VfsRevisionRepository,
  path: string,
  fromVersion: number,
  toVersion: number,
): Promise<void> {
  if (fromVersion === toVersion) {
    return;
  }
  await adjustRef(revisionRepo, path, fromVersion, -1);
  await adjustRef(revisionRepo, path, toVersion, +1);
}

function toPhysicalPointers(
  scope: Extract<VfsScope, { kind: "session" }>,
  files: ReadonlyArray<CheckpointFilePointer>,
): ReadonlyArray<{ path: string; version: number }> {
  return files.map((file) => ({
    path: toPhysicalPath(scope, file.logicalPath),
    version: file.revisionVersion,
  }));
}

/** checkpoint_file 行列表 → 每条 physical (path, version) +1。 */
export async function incrementRefsForCheckpointFiles(
  revisionRepo: VfsRevisionRepository,
  scope: Extract<VfsScope, { kind: "session" }>,
  files: ReadonlyArray<CheckpointFilePointer>,
): Promise<void> {
  for (const pair of toPhysicalPointers(scope, files)) {
    await adjustRef(revisionRepo, pair.path, pair.version, +1);
  }
}

/** checkpoint_file 行列表 → 每条 physical (path, version) −1。 */
export async function decrementRefsForCheckpointFiles(
  revisionRepo: VfsRevisionRepository,
  scope: Extract<VfsScope, { kind: "session" }>,
  files: ReadonlyArray<CheckpointFilePointer>,
): Promise<void> {
  for (const pair of toPhysicalPointers(scope, files)) {
    await adjustRef(revisionRepo, pair.path, pair.version, -1);
  }
}

/** 前缀打扫：DELETE … WHERE path 匹配 session prefix AND ref_count <= 0。 */
export async function deleteUnreferencedUnderPrefix(
  revisionRepo: VfsRevisionRepository,
  prefix: string,
): Promise<number> {
  return revisionRepo.deleteUnreferencedUnderPrefix(prefix);
}

/**
 * 空闲校验：重算 checkpoint 行数 + live head，只上调 ref_count（禁止因偏低误删）。
 */
export async function repairRefCounts(
  revisionRepo: VfsRevisionRepository,
  entryRepo: VfsEntryRepository,
  checkpoints: MessageCheckpointRepository,
  scope: Extract<VfsScope, { kind: "session" }>,
): Promise<RepairReport> {
  const prefix = scopePhysicalPrefix(scope);
  const expected = new Map<string, number>();

  const bump = (path: string, version: number): void => {
    const key = `${path}:${version}`;
    expected.set(key, (expected.get(key) ?? 0) + 1);
  };

  const pointers = await checkpoints.listFilePointersForSession(scope.sessionId);
  for (const pointer of pointers) {
    bump(
      toPhysicalPath(scope, pointer.logicalPath),
      pointer.revisionVersion,
    );
  }

  const liveHeads = await entryRepo.listFileHeadsUnderPrefix(prefix);
  for (const head of liveHeads) {
    bump(head.path, head.headVersion);
  }

  let rowsAdjusted = 0;
  const keys = await revisionRepo.listKeysUnderPrefix(prefix);
  for (const { path, version } of keys) {
    const key = `${path}:${version}`;
    const want = expected.get(key) ?? 0;
    const adjusted = await revisionRepo.repairRefCountFloor(path, version, want);
    if (adjusted) {
      rowsAdjusted++;
    }
  }

  return { rowsAdjusted, rowsExamined: keys.length };
}

/** session 前缀下全部 live file head 批量 −1（会话删除 Step 2）。 */
export async function decrementLiveRefsUnderPrefix(
  revisionRepo: VfsRevisionRepository,
  entryRepo: VfsEntryRepository,
  prefix: string,
): Promise<void> {
  const liveHeads = await entryRepo.listFileHeadsUnderPrefix(prefix);
  for (const head of liveHeads) {
    await adjustRef(revisionRepo, head.path, head.headVersion, -1);
  }
}
