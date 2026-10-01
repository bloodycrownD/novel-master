/**
 * 写文件 + append revision + 迁移 live ref 的**共享**领域函数。
 *
 * 原为 `revision-aware-vfs.service.ts` 的模块私有实现；下沉到 domain 层是为了让
 * 批量 ingest（非 session 通道）复用同一条写路径——此前它绕开 revision 层直接
 * `repo.update`，产出「entry.head_version 指向不存在的 version」的悬空 head，
 * 后续任一 checkpoint 钉住该 head 即抛 `VfsError NOT_FOUND: Revision not found`，
 * 真 head 的 ref 停在 1 ⇒ revision 与 blob 永久不可回收。
 *
 * ⚠️ **它不是纯函数**：有 IO（走两个 repo）且读 `Date.now()`。单测请用真实
 * 仓储/夹具断言，不要按纯函数的 expectation 写。
 *
 * @module domain/vfs/logic/write-with-revision
 */

import { ensureParentDirectories } from "./ensure-parent-dirs.js";
import { assertValidVfsEntryName } from "./validate-entry-name.js";
import { normalizePath } from "../repositories/impl/normalize-path.js";
import { adjustRef, transferLiveRef } from "./revision-ref-count.js";
import type { VfsEntryRepository } from "../repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "../repositories/vfs-revision.port.js";
import { vfsIsDirectory } from "@/errors/vfs-errors.js";

export interface WriteWithRevisionOptions {
  /**
   * 跳过「文件名合法性」校验（`assertValidVfsEntryName`）。
   *
   * 默认为 `false`。**导入链路传 `true`**：`validate-entry-name.ts` 的 JSDoc
   * 明确「只拦『用户/agent 显式创建与重命名』的入口；导入链路（zip/角色卡）
   * 不走本校验（外部文件名可先导入再用改名功能纠正）」。批量 ingest 是 zip
   * 导入的创建通道，它的输入恰恰是外部文件名 ⇒ 传 false 会把「以前能导入的
   * 外部文件名」变成「导入失败」，改变一条已拍板的导入语义。
   *
   * 该校验只在 `existing == null`（**新条目诞生**）分支调用；存量条目的内容
   * 更新不重新审判名字。
   */
  readonly skipNameValidation?: boolean;
}

/**
 * 写一条文件内容并落一条 revision 活行，返回新 head 版本。
 *
 * 零 service 层依赖（只吃两个 repo），故下沉不违反分层。
 */
export async function writeWithRevision(
  entryRepo: VfsEntryRepository,
  revisionRepo: VfsRevisionRepository,
  scopeKey: string,
  path: string,
  content: string,
  options: WriteWithRevisionOptions = {}
): Promise<{ version: number }> {
  const normalized = normalizePath(path);
  const existing = await entryRepo.findByPath(scopeKey, normalized);
  if (existing?.entryKind === "directory") {
    throw vfsIsDirectory(normalized);
  }

  const mtimeMs = Date.now();
  let version: number;

  if (existing == null) {
    // 只拦「创建」：存量条目（含 zip 导入的历史名）内容更新不重新审判名字
    if (options.skipNameValidation !== true) {
      assertValidVfsEntryName(normalized);
    }
    await ensureParentDirectories(entryRepo, scopeKey, normalized);
    const maxRevision = await resolveMaxRevision(
      entryRepo,
      revisionRepo,
      scopeKey,
      normalized
    );
    if (maxRevision != null) {
      // Boundary: vfs_entry removed but revision history retained (e.g. batch rollback restore).
      version = maxRevision + 1;
      await entryRepo.insertAtVersion(scopeKey, normalized, content, version);
    } else {
      const inserted = await entryRepo.insert(scopeKey, normalized, content);
      version = inserted.version;
    }
    const entry = await entryRepo.findByPath(scopeKey, normalized);
    const entryId = entry!.entryId;
    await revisionRepo.append({
      entryId,
      version,
      content,
      status: "active",
      mtimeMs,
    });
    await adjustRef(revisionRepo, entryId, version, +1);
    return { version };
  }

  // 同文短路：相对 live 明文全等 → 不 bump、不 append
  if (existing.content === content) {
    return { version: existing.version };
  }

  // 统一分配器：max(head, MAX(version)) + 1，避开 head 回拨后历史占号段
  const nextVersion = await nextVersionFor(
    revisionRepo,
    existing.entryId,
    existing.version
  );
  const updated = await entryRepo.update(
    scopeKey,
    normalized,
    content,
    nextVersion
  );
  version = updated.version;
  await revisionRepo.append({
    entryId: existing.entryId,
    version,
    content,
    status: "active",
    mtimeMs,
  });
  await transferLiveRef(
    revisionRepo,
    existing.entryId,
    existing.version,
    version
  );
  return { version };
}

/**
 * 统一版本分配器：`max(headVersion, MAX(vfs_revision.version)) + 1`。
 *
 * head 回拨（resetHead 后高版本被 checkpoint 钉住）时 `head_version < MAX(version)`
 * 是合法状态，新号必须越过 MAX 才能避开历史占号段；防御性的 `max(headVersion, …)`
 * 在健康库上与 head + 1 等价。
 */
export async function nextVersionFor(
  revisionRepo: VfsRevisionRepository,
  entryId: number,
  headVersion: number
): Promise<number> {
  const maxStored = await revisionRepo.findMaxVersionForEntry(entryId);
  return Math.max(headVersion, maxStored ?? 0) + 1;
}

/**
 * entry_id 通道下，max revision 通过 entry_id 寻址。
 *
 * 先取 entryId（entry 不存在时返回 null），然后按 entry_id 查 max version。
 * 这覆盖了「entry 已删但 revision 仍在」的边界场景：此时 entry 不存在，
 * resolveMaxRevision 返回 null，writeWithRevision 走 insert v1。
 */
export async function resolveMaxRevision(
  entryRepo: VfsEntryRepository,
  revisionRepo: VfsRevisionRepository,
  scopeKey: string,
  path: string
): Promise<number | null> {
  const entry = await entryRepo.findByPath(scopeKey, path);
  if (entry == null) {
    return null;
  }
  return revisionRepo.findMaxVersionForEntry(entry.entryId);
}
