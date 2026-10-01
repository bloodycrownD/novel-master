/**
 * vfs_revision.ref_count 维护辅助（checkpoint 指针 + live head + read 引用）。
 *
 * entry_id 化后全部按 `entryId` 寻址：checkpoint 行已存 entry_id，live head 扫描返回
 * entry_id。前缀打扫按 `(scopeKey, pathPrefix)` 经 revision repo 的 scope 扫描圈定。
 * read 引用（read-tool-result-ref）是第三类持有者：消息 tool_result 块的
 * `contentRef` 按全局键 `(entryId, version)` 跨会话指向源 revision。
 *
 * @module domain/vfs/logic/revision-ref-count
 */

import type { MessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/message-checkpoint.port.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import type { IntegrityRepairOperation } from "@/service/integrity-repair.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { parseMessageContent } from "@/domain/chat/content/parse-message-content.js";
import { decodeMessageContent } from "@/domain/chat/logic/message-content-codec.js";
import type { MessageContent } from "@/domain/chat/model/content-block.js";
import { isVfsPathExcluded } from "./vfs-exclude-prefixes.js";

/** checkpoint 文件指针（entry_id 形态）。 */
export type CheckpointFilePointer = {
  readonly entryId: number;
  readonly revisionVersion: number;
};

/**
 * 消息侧 read 引用指针：`contentRef` 的全局键 `(entryId, version)`
 * （read-tool-result-ref，第三类持有者）。
 */
export type ReadRefPointer = {
  readonly entryId: number;
  readonly version: number;
};

/**
 * 多条消息的 read 引用聚合：`count` = 持有该 pair 的消息数
 * （消息内去重、消息间累加——对账口径与 T-RR4 一致）。
 */
export type ReadRefCountAggregate = ReadRefPointer & {
  readonly count: number;
};

/**
 * repair 期望值超出当前 `ref_count` 的行（疑似泄漏——如 read +1 已发生但
 * 消息未落库即崩溃）。**只报告不自动修**：只增不减哲学下泄漏可检测、
 * 误删不可恢复，方向性选择宁多不少。
 */
export type OverExpectedRefRow = {
  readonly entryId: number;
  readonly version: number;
  /** 当前库里的 ref_count。 */
  readonly current: number;
  /** 三类持有者期望值之和（checkpoint 指针 + live head + read 引用）。 */
  readonly expected: number;
};

/** repairRefCounts 报告。 */
export type RepairReport = {
  readonly rowsAdjusted: number;
  readonly rowsExamined: number;
  /** 期望值三类化后检出的偏高泄漏行（只报告，不自动修）。 */
  readonly overExpected: ReadonlyArray<OverExpectedRefRow>;
};

/**
 * 单条消息（或单个 blocks 集合）内的 read 引用收集：按 `(entryId, version)` 去重——
 * 同一消息里多个块引用同一 pair 只算一次（T-RR4 对账口径；跨消息的重复持有
 * 由 {@link aggregateReadRefs} 累加）。
 */
export function collectReadRefs(content: MessageContent): ReadRefPointer[] {
  const seen = new Set<string>();
  const refs: ReadRefPointer[] = [];
  for (const block of content.blocks) {
    if (block.type !== "tool_result" || block.contentRef == null) {
      continue;
    }
    const key = `${block.contentRef.entryId}:${block.contentRef.version}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    refs.push({
      entryId: block.contentRef.entryId,
      version: block.contentRef.version,
    });
  }
  return refs;
}

/**
 * 多条消息聚合 read 引用：消息内去重、消息间累加。
 *
 * 挂点两侧共用同一口径——fork/copy 的 +1 与删除路径的 −1 都用它，
 * 保证「每条持有消息恰好 +1 / −1」严格对账。
 */
export function aggregateReadRefs(
  contents: readonly MessageContent[]
): ReadRefCountAggregate[] {
  const counts = new Map<string, ReadRefCountAggregate>();
  addAggregates(counts, contents);
  return [...counts.values()];
}

function addAggregates(
  counts: Map<string, ReadRefCountAggregate>,
  contents: readonly MessageContent[]
): void {
  for (const content of contents) {
    for (const ref of collectReadRefs(content)) {
      const key = `${ref.entryId}:${ref.version}`;
      const existing = counts.get(key);
      if (existing == null) {
        counts.set(key, { ...ref, count: 1 });
      } else {
        counts.set(key, { ...existing, count: existing.count + 1 });
      }
    }
  }
}

/**
 * 批量调整 read 引用计数（fork/copy +1、删除路径 −1）。
 *
 * 底层走 `batchAdjustRefCountWithDelta`：+1 缺行抛 NOT_FOUND（read 引用的
 * 存在性校验——fork 复制的消息引用的源 revision 必须活着）；−1 命不中即
 * no-op。重复持有（`count > 1`）由 delta 承载——`IN (...)` 对重复 pair 只
 * UPDATE 一次，不能靠重复指针叠加。
 */
export async function adjustReadRefCount(
  revisionRepo: VfsRevisionRepository,
  refs: ReadonlyArray<ReadRefPointer & { readonly count?: number }>,
  delta: 1 | -1
): Promise<void> {
  if (refs.length === 0) {
    return;
  }
  // 按权重（delta × count）分桶：同桶一批 UPDATE，桶间各自一条批量语句。
  const byWeight = new Map<number, Array<{ entryId: number; version: number }>>();
  for (const ref of refs) {
    const weight = delta * (ref.count ?? 1);
    if (weight === 0) {
      continue;
    }
    const bucket = byWeight.get(weight);
    if (bucket == null) {
      byWeight.set(weight, [{ entryId: ref.entryId, version: ref.version }]);
    } else {
      bucket.push({ entryId: ref.entryId, version: ref.version });
    }
  }
  for (const [weight, pointers] of byWeight) {
    await revisionRepo.batchAdjustRefCountWithDelta(pointers, weight);
  }
}

/**
 * 全库消息的 read 引用聚合（repair 三类化用）。
 *
 * read 引用按全局键跨会话指向源 revision（fork/copy 复制的消息同样持有），
 * 期望值对账必须扫全库消息而不能只扫当前 session。压缩行（content_blob）
 * 走 `decodeMessageContent` 解码；单行解析失败跳过（期望值偏保守 = floor
 * 不下调，方向安全），不影响其余行。
 */
export async function aggregateReadRefsFromAllMessages(
  conn: TdbcConnection
): Promise<ReadRefCountAggregate[]> {
  const rows = await conn.query<{
    id: string;
    content_encoding: string | null;
    content_blob: Uint8Array | string | null;
    content_json: string | null;
  }>(
    `SELECT id, content_encoding, content_blob, content_json FROM chat_message`
  );
  const counts = new Map<string, ReadRefCountAggregate>();
  for (const row of rows) {
    let content: MessageContent;
    try {
      const text =
        row.content_blob != null
          ? decodeMessageContent(
              row.content_encoding,
              row.content_blob,
              String(row.id)
            )
          : String(row.content_json);
      content = parseMessageContent(text);
    } catch (err) {
      console.warn(
        "[revision-ref-count] read_ref_aggregate_row_skip：消息行解析失败，跳过其 read 引用",
        { id: String(row.id), err: err instanceof Error ? err.message : err }
      );
      continue;
    }
    addAggregates(counts, [content]);
  }
  return [...counts.values()];
}

/** 单条 (entryId, version) ±1。 */
export async function adjustRef(
  revisionRepo: VfsRevisionRepository,
  entryId: number,
  version: number,
  delta: 1 | -1
): Promise<void> {
  await revisionRepo.adjustRefCount(entryId, version, delta);
}

/** live head 从旧版转移到新版（write bump / resetHead）。 */
export async function transferLiveRef(
  revisionRepo: VfsRevisionRepository,
  entryId: number,
  fromVersion: number,
  toVersion: number
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
  files: ReadonlyArray<CheckpointFilePointer>
): Promise<void> {
  // 走批量 +1，缺失行会报 NOT_FOUND（守护 T-RB-REF-MISSING），跟原来的逐条语义一致
  await revisionRepo.batchAdjustRefCount(
    files.map((f) => ({ entryId: f.entryId, version: f.revisionVersion })),
    +1
  );
}

/** checkpoint_file 行列表 → 每条 (entryId, version) −1。 */
export async function decrementRefsForCheckpointFiles(
  revisionRepo: VfsRevisionRepository,
  files: ReadonlyArray<CheckpointFilePointer>
): Promise<void> {
  // 减引用时缺失行 no-op（UPDATE 命不中即跳过），所以不需要前置校验
  await revisionRepo.batchAdjustRefCount(
    files.map((f) => ({ entryId: f.entryId, version: f.revisionVersion })),
    -1
  );
}

/** 前缀打扫：scope + path 前缀下 DELETE ref_count<=0 的 revision 行。
 *
 * `excludePrefixes` 非空时，排除前缀下的 revision 不参与 GC（隔离豁免）。 */
export async function deleteUnreferencedUnderScope(
  revisionRepo: VfsRevisionRepository,
  scopeKey: string,
  pathPrefix: string,
  excludePrefixes?: readonly string[]
): Promise<number> {
  return revisionRepo.deleteUnreferencedUnderScope(
    scopeKey,
    pathPrefix,
    excludePrefixes
  );
}

/**
 * 空闲校验：重算 checkpoint 行数 + live head + read 引用（三类持有者），
 * 只上调 ref_count（禁止因偏低误删）；偏高（疑似泄漏）只报告。
 *
 * @remarks 可对任意 scope 调用；bootstrap W3 作为全局 template 兜底以 (global, /)
 * 触发，只覆盖 global scope，session/project 靠 migration 保留 ref_count。
 * read 引用跨会话持有源 revision，`readRefs` 必须由调用方按全库口径聚合
 * （见 {@link aggregateReadRefsFromAllMessages}）。
 */
export async function repairRefCounts(
  revisionRepo: VfsRevisionRepository,
  entryRepo: VfsEntryRepository,
  checkpoints: MessageCheckpointRepository,
  scopeKey: string,
  pathPrefix: string,
  sessionId: string,
  readRefs?: readonly ReadRefCountAggregate[]
): Promise<RepairReport> {
  const expected = new Map<string, number>();

  const bump = (entryId: number, version: number): void => {
    const key = `${entryId}:${version}`;
    expected.set(key, (expected.get(key) ?? 0) + 1);
  };

  // 持有者一：checkpoint 文件指针。
  const pointers = await checkpoints.listFilePointersForSession(sessionId);
  for (const pointer of pointers) {
    bump(pointer.entryId, pointer.revisionVersion);
  }

  // 持有者二：live head。
  const liveHeads = await entryRepo.listFileHeadsUnderPrefix(
    scopeKey,
    pathPrefix
  );
  for (const head of liveHeads) {
    bump(head.entryId, head.headVersion);
  }

  // 持有者三：消息侧 read 引用（contentRef，跨会话全局键；count = 持有消息数）。
  for (const ref of readRefs ?? []) {
    const key = `${ref.entryId}:${ref.version}`;
    expected.set(key, (expected.get(key) ?? 0) + ref.count);
  }

  // 带回当前 ref_count 一次取齐：偏低走 floor 上调，偏高只报告。
  const rows = await revisionRepo.listKeysWithRefCountUnderScope(
    scopeKey,
    pathPrefix
  );
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

  // 偏高泄漏检测（T-RR13）：ref_count 超过三类期望值之和——不自动修
  //（只增不减：泄漏方向可接受，误删不可恢复），交给报告方决定处置。
  const overExpected = rows
    .filter(
      (row) =>
        row.refCount >
        (expected.get(`${row.entryId}:${row.version}`) ?? 0)
    )
    .map((row) => ({
      entryId: row.entryId,
      version: row.version,
      current: row.refCount,
      expected: expected.get(`${row.entryId}:${row.version}`) ?? 0,
    }));

  return { rowsAdjusted, rowsExamined: rows.length, overExpected };
}

/**
 * 把 {@link repairRefCounts} 包成 `repair` 类型的 {@link IntegrityRepairOperation}。
 *
 * detect 只读地扫一眼 scope 下有没有 revision 行：有的话保守地标记 needsRepair=true，
 * 具体偏差交给幂等的 repair 自己处理（`batchRepairRefCountFloor` 只增不减，重复跑安全）。
 *
 * 注意：这条路径只动 `vfs_revision.ref_count`，**完全不碰** `vfs_content_blob.ref_count`
 * ——后者由 SQLite 触发器在 revision INSERT/DELETE/UPDATE OF content_hash 时维护。
 * `batchRepairRefCountFloor` 只更新 `ref_count` 列、不改 `content_hash`，触发器不会 fire，
 * 所以应用层修复和触发器维护两条路径不会重复计数（T-SC5 守护的不变量）。
 */
export function createRevisionRefCountRepairOperation(args: {
  readonly revisionRepo: VfsRevisionRepository;
  readonly entryRepo: VfsEntryRepository;
  readonly checkpoints: MessageCheckpointRepository;
  readonly scopeKey: string;
  readonly pathPrefix: string;
  readonly sessionId: string;
  /**
   * 传入时 repair 期望值三类化：全库消息 read 引用并入期望值
   * （read-tool-result-ref），偏高泄漏进入报告的 overExpected（不自动修）。
   */
  readonly conn?: TdbcConnection;
}): IntegrityRepairOperation {
  const {
    revisionRepo,
    entryRepo,
    checkpoints,
    scopeKey,
    pathPrefix,
    sessionId,
    conn,
  } = args;
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
        details: `scope=${scopeKey} prefix=${pathPrefix || "/"} 下有 ${
          keys.length
        } 条 revision 行，交给幂等 repair 兜底`,
      };
    },
    async repair() {
      const readRefs =
        conn == null
          ? undefined
          : await aggregateReadRefsFromAllMessages(conn);
      await repairRefCounts(
        revisionRepo,
        entryRepo,
        checkpoints,
        scopeKey,
        pathPrefix,
        sessionId,
        readRefs
      );
    },
  };
}

/** scope + path 前缀下全部 live file head 批量 −1（会话删除 Step 2）。
 *
 * `excludePrefixes` 非空时，排除前缀下的 live head 引用不减（隔离豁免）。 */
export async function decrementLiveRefsUnderScope(
  revisionRepo: VfsRevisionRepository,
  entryRepo: VfsEntryRepository,
  scopeKey: string,
  pathPrefix: string,
  excludePrefixes?: readonly string[]
): Promise<void> {
  const excludes = excludePrefixes ?? [];
  const liveHeads = await entryRepo.listFileHeadsUnderPrefix(
    scopeKey,
    pathPrefix
  );
  // 批量减引用，避免对每个 live head 发一条 SQL（会话删除场景下文件多会卡）
  await revisionRepo.batchAdjustRefCount(
    liveHeads
      .filter((h) => !isVfsPathExcluded(h.path, excludes))
      .map((h) => ({ entryId: h.entryId, version: h.headVersion })),
    -1
  );
}
