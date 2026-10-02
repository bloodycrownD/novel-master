/**
 * VFS 批量 ingest/export：plan + 非 session 事务 apply + session writer apply。
 *
 * @module service/vfs/impl/vfs-batch-io.service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { ensureParentDirectories } from "@/domain/vfs/logic/ensure-parent-dirs.js";
import {
  joinTargetLogicalPath,
  normalizeBatchRelativePath,
  relativePathUnderAnchor,
} from "@/domain/vfs/logic/vfs-batch-path.js";
import { writeWithRevision } from "@/domain/vfs/logic/write-with-revision.js";
import {
  assertLogicalPathAllowed,
  resolveLogicalPath,
  scopeKey,
  type VfsScope,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import {
  ZIP_AND_CARD_IMPORT_TXN_FILE_CHUNK,
  chunkArray,
  yieldToEventLoop,
} from "@/domain/vfs/logic/vfs-import-chunk.js";
import type {
  BatchApplyOptions,
  BatchApplyReport,
  BatchConflict,
  BatchExportPlan,
  BatchExportSkip,
  BatchIngestPlan,
  BatchIngestPlanEntry,
  BatchIngestRawEntry,
  BatchIngestWriter,
  VfsBatchIoService,
} from "@/domain/vfs/ports/vfs-batch-io.port.js";

/** @internal 单测钩子：事务写入中途失败以验证整批回滚 */
export type VfsBatchImportTestHook = {
  readonly throwOnWriteLogical?: string;
};

function stripUtf8Bom(bytes: Uint8Array): Uint8Array {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return bytes.subarray(3);
  }
  return bytes;
}

/** 与 ZIP 校验一致：round-trip，Hermes 与 Node 行为对齐。 */
function tryDecodeUtf8(bytes: Uint8Array): string | null {
  const payload = stripUtf8Bom(bytes);
  const decoded = new TextDecoder("utf-8").decode(payload);
  const roundTrip = new TextEncoder().encode(decoded);
  if (payload.length !== roundTrip.length) {
    return null;
  }
  for (let i = 0; i < payload.length; i++) {
    if (payload[i] !== roundTrip[i]) {
      return null;
    }
  }
  return decoded;
}

async function ensureEmptyDirectoryRow(
  repo: VfsEntryRepository,
  scope: VfsScope,
  logical: string
): Promise<void> {
  const sk = scopeKey(scope);
  await ensureParentDirectories(repo, sk, `${logical}/__vfs_batch_placeholder`);
  const existing = await repo.findByPath(sk, logical);
  if (existing == null) {
    await repo.insertDirectory(sk, logical);
    return;
  }
  if (existing.entryKind === "file") {
    throw new Error(`path is a file, not a directory: ${logical}`);
  }
}

/** 分块写入单个文件：走共享的 revision 写路径（不再绕开 revision 层）。 */
async function writeOrUpdateFile(
  entryRepo: VfsEntryRepository,
  revisionRepo: SqliteVfsRevisionRepository,
  scope: VfsScope,
  logical: string,
  content: string
): Promise<void> {
  const sk = scopeKey(scope);
  // WHY 外面保底父链：writeWithRevision 只在**新建**分支调 ensureParentDirectories，
  // 而批量 ingest 允许覆盖已有路径 ⇒ 已有路径的父链不由它兜。
  await ensureParentDirectories(entryRepo, sk, logical);
  // skipNameValidation=true：批量 ingest 是 zip 导入的创建通道，输入是**外部
  // 文件名**；`validate-entry-name.ts` 的 JSDoc 明确导入链路不走名校验
  // （外部文件名可先导入再用改名纠正）。传 false 会把「以前能导入的外部文件名」
  // 变成「导入失败」，改变一条已拍板的导入语义。
  await writeWithRevision(entryRepo, revisionRepo, sk, logical, content, {
    skipNameValidation: true,
  });
}

function emptyReport(
  skipped: string[] = [],
  failed: BatchApplyReport["failed"] = []
): BatchApplyReport {
  return { written: [], skipped, failed: [...failed] };
}

function relativePathPrefixes(rel: string): string[] {
  const parts = rel.split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    out.push(parts.slice(0, i).join("/"));
  }
  return out;
}

function detectIngestTypeConflict(
  rel: string,
  kind: "file" | "directory",
  pathKind: Map<string, "file" | "directory">
): string | null {
  const existing = pathKind.get(rel);
  if (existing != null && existing !== kind) {
    return `path cannot be both file and directory: ${rel}`;
  }

  for (const prefix of relativePathPrefixes(rel)) {
    if (pathKind.get(prefix) === "file") {
      return `cannot place ${kind} under file: ${prefix}`;
    }
  }

  if (kind === "file") {
    for (const [p, k] of pathKind) {
      if (k === "file" && p.startsWith(`${rel}/`)) {
        return `cannot place file under file: ${rel}`;
      }
    }
  } else {
    for (const [p, k] of pathKind) {
      if (k === "file" && p.startsWith(`${rel}/`)) {
        return `cannot create directory over nested file: ${p}`;
      }
    }
  }

  return null;
}

function basenameOf(logical: string): string {
  const path = resolveLogicalPath(logical);
  if (path === "/") {
    return "";
  }
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * 逻辑路径的父目录（根下文件返回 `/`）。
 *
 * 只给「选中项本身是文件」的导出分支当锚点用——多选时带一层父目录名，
 * 才能让 `/卷一/第一章.md` 与 `/卷二/第一章.md` 不撞名。
 * ⚠️ **锚点绝不能用 `logical` 自身**：`relativePathUnderAnchor(p, p)` 按定义返回空串，
 * 调用方会 `continue` 掉，单选一个文件会被整个丢掉。
 */
function parentLogicalOf(logical: string): string {
  const path = resolveLogicalPath(logical);
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}

/**
 * 多选导出相对路径：单选时相对该锚点；多选时带顶层 basename，避免摊平冲突。
 */
function exportRelativePath(
  childLogical: string,
  anchorLogical: string,
  selectionCount: number
): string {
  const under = relativePathUnderAnchor(childLogical, anchorLogical);
  if (selectionCount <= 1) {
    return under;
  }
  const rootName = basenameOf(anchorLogical);
  if (rootName.length === 0) {
    return under;
  }
  return under.length === 0 ? rootName : `${rootName}/${under}`;
}

export type DefaultVfsBatchIoServiceOptions = {
  /** @internal 回滚单测专用 */
  readonly testHook?: VfsBatchImportTestHook;
};

export class DefaultVfsBatchIoService implements VfsBatchIoService {
  private readonly testHook?: VfsBatchImportTestHook;

  constructor(
    private readonly conn: TdbcConnection,
    private readonly repo: VfsEntryRepository,
    options: DefaultVfsBatchIoServiceOptions = {}
  ) {
    this.testHook = options.testHook;
  }

  async planBatchIngest(
    scope: VfsScope,
    targetDir: string,
    entries: readonly BatchIngestRawEntry[]
  ): Promise<BatchIngestPlan> {
    const target = resolveLogicalPath(targetDir);
    assertLogicalPathAllowed(scope, target);

    const writes: BatchIngestPlanEntry[] = [];
    const mkdirPaths: string[] = [];
    const conflicts: BatchConflict[] = [];
    const skippedBinary: string[] = [];
    const typeConflicts: Array<{ logicalPath: string; message: string }> = [];
    const seenLogical = new Set<string>();
    const pathKind = new Map<string, "file" | "directory">();

    for (const entry of entries) {
      const rel = normalizeBatchRelativePath(entry.relativePath);
      if (rel == null) {
        skippedBinary.push(entry.relativePath);
        continue;
      }

      const kind = entry.kind === "directory" ? "directory" : "file";
      const typeConflict = detectIngestTypeConflict(rel, kind, pathKind);
      if (typeConflict != null) {
        const logical = joinTargetLogicalPath(target, rel);
        typeConflicts.push({ logicalPath: logical, message: typeConflict });
        continue;
      }
      pathKind.set(rel, kind);

      if (entry.kind === "directory") {
        const logical = joinTargetLogicalPath(target, rel);
        assertLogicalPathAllowed(scope, logical);
        if (!seenLogical.has(logical)) {
          seenLogical.add(logical);
          mkdirPaths.push(logical);
        }
        continue;
      }

      const decoded = tryDecodeUtf8(entry.bytes);
      if (decoded == null) {
        skippedBinary.push(rel);
        continue;
      }

      const logical = joinTargetLogicalPath(target, rel);
      assertLogicalPathAllowed(scope, logical);
      if (seenLogical.has(logical)) {
        continue;
      }
      seenLogical.add(logical);

      const existing = await this.repo.findByPath(scopeKey(scope), logical);
      if (existing != null && existing.entryKind === "file") {
        conflicts.push({ logicalPath: logical, reason: "exists" });
      }

      writes.push({ relativePath: rel, content: decoded });
    }

    return { writes, mkdirPaths, conflicts, skippedBinary, typeConflicts };
  }

  async applyBatchIngest(
    scope: VfsScope,
    _targetDir: string,
    plan: BatchIngestPlan,
    options: BatchApplyOptions
  ): Promise<BatchApplyReport> {
    const skippedBase = [...plan.skippedBinary];

    if (plan.typeConflicts.length > 0) {
      return emptyReport(
        skippedBase,
        plan.typeConflicts.map((c) => ({
          path: c.logicalPath,
          message: c.message,
        }))
      );
    }

    if (plan.conflicts.length > 0 && !options.overwriteConfirmed) {
      return emptyReport([
        ...skippedBase,
        ...plan.conflicts.map((c) => c.logicalPath),
      ]);
    }

    const target = resolveLogicalPath(_targetDir);
    const writtenLogical: string[] = [];

    // 分片提交（CS-05）：段 B0 = mkdir 行独立短事务；段 B1..Bk = 每片 ≤200 个
    // write 各一条短事务。失败片回滚、已提交片保留 ⇒ `written` 如实列出已提交
    // 分片（分片前 `written` 恒为空，是因为整批只有一条事务）。
    let failedPath: string | null = null;
    let failureMessage: string | null = null;
    let committedShards = 0;

    // 段 B0：mkdir 行独立一条短事务（plan.writes 为空时这就是唯一一条）。
    if (plan.mkdirPaths.length > 0) {
      try {
        await this.conn.transaction(async (tx) => {
          const repoTx = new SqliteVfsEntryRepository(tx);
          for (const dirLogical of plan.mkdirPaths) {
            await ensureEmptyDirectoryRow(repoTx, scope, dirLogical);
          }
        });
        committedShards += 1;
      } catch (error) {
        failedPath = plan.mkdirPaths[0]!;
        failureMessage =
          error instanceof Error
            ? error.message
            : "batch ingest transaction failed";
      }
    }

    // 段 B1..Bk：逐片提交。`written` 只在片**提交后**并入——回调内 push 会把
    // 回滚片的内容也算进报告。
    let shardIndex = 0;
    if (failedPath == null) {
      for (const shard of chunkArray(
        plan.writes,
        ZIP_AND_CARD_IMPORT_TXN_FILE_CHUNK
      )) {
        const shardWritten: string[] = [];
        try {
          await this.conn.transaction(async (tx) => {
            const repoTx = new SqliteVfsEntryRepository(tx);
            const revisionTx = new SqliteVfsRevisionRepository(tx);
            for (const write of shard) {
              const logical = joinTargetLogicalPath(
                target,
                write.relativePath
              );
              if (this.testHook?.throwOnWriteLogical === logical) {
                throw new Error("test batch ingest failure");
              }
              await writeOrUpdateFile(
                repoTx,
                revisionTx,
                scope,
                logical,
                write.content
              );
              shardWritten.push(logical);
            }
          });
          writtenLogical.push(...shardWritten);
          committedShards += 1;
          shardIndex += 1;
        } catch (error) {
          failedPath = joinTargetLogicalPath(target, shard[0]!.relativePath);
          failureMessage =
            error instanceof Error
              ? error.message
              : "batch ingest transaction failed";
          break;
        }
        // 让步只落在片与片之间，绝不落在事务回调内部。
        await yieldToEventLoop();
      }
    }

    if (failedPath != null) {
      return {
        written: [...writtenLogical],
        skipped: skippedBase,
        failed: [
          {
            path: failedPath,
            message: `${failureMessage ?? "batch ingest failed"}（已提交 ${committedShards} 片，失败在第 ${shardIndex + 1} 片）`,
          },
        ],
      };
    }

    return {
      written: writtenLogical,
      skipped: skippedBase,
      failed: [],
    };
  }

  async applyBatchIngestWithWriter(
    targetDir: string,
    plan: BatchIngestPlan,
    options: BatchApplyOptions,
    writer: BatchIngestWriter
  ): Promise<BatchApplyReport> {
    const skipped: string[] = [...plan.skippedBinary];

    if (plan.typeConflicts.length > 0) {
      return {
        written: [],
        skipped,
        failed: plan.typeConflicts.map((c) => ({
          path: c.logicalPath,
          message: c.message,
        })),
      };
    }

    if (plan.conflicts.length > 0 && !options.overwriteConfirmed) {
      for (const c of plan.conflicts) {
        if (!skipped.includes(c.logicalPath)) {
          skipped.push(c.logicalPath);
        }
      }
      return { written: [], skipped, failed: [] };
    }

    const target = resolveLogicalPath(targetDir);
    const written: string[] = [];
    const failed: Array<{ path: string; message: string }> = [];

    for (const dirLogical of plan.mkdirPaths) {
      try {
        await writer.mkdir(dirLogical);
      } catch (error) {
        const message = error instanceof Error ? error.message : "mkdir failed";
        failed.push({ path: dirLogical, message });
      }
    }

    for (const write of plan.writes) {
      const logical = joinTargetLogicalPath(target, write.relativePath);
      try {
        await writer.writeFile(logical, write.content);
        written.push(logical);
      } catch (error) {
        const message = error instanceof Error ? error.message : "write failed";
        failed.push({ path: logical, message });
      }
    }

    return { written, skipped, failed };
  }

  async planBatchExport(
    scope: VfsScope,
    logicalPaths: readonly string[]
  ): Promise<BatchExportPlan> {
    const files: Array<{ relativePath: string; content: string }> = [];
    const mkdirPaths: string[] = [];
    const skipped: BatchExportSkip[] = [];
    const seenFileRels = new Set<string>();
    const seenDirRels = new Set<string>();
    const selectionCount = logicalPaths.length;
    const sk = scopeKey(scope);

    for (const raw of logicalPaths) {
      const logical = resolveLogicalPath(raw);
      assertLogicalPathAllowed(scope, logical);
      const existing = await this.repo.findByPath(sk, logical);

      if (existing != null && existing.entryKind === "file") {
        // 锚点取**父目录**：多选时带一层父目录名，避免同名文件（中文工程常见
        // 「同名卷章」）被 `seenFileRels` 静默丢弃。单选时与旧的 basename 形态一致。
        const fileRel = exportRelativePath(
          logical,
          parentLogicalOf(logical),
          selectionCount
        );
        if (fileRel.length > 0 && !seenFileRels.has(fileRel)) {
          seenFileRels.add(fileRel);
          files.push({ relativePath: fileRel, content: existing.content });
        } else if (fileRel.length > 0) {
          // 撞名：报告而不是静默丢（锚点改父目录消不掉「文件与目录同选」那一类碰撞）
          skipped.push({
            logicalPath: logical,
            reason: "DUPLICATE_RELATIVE_PATH",
          });
        }
        continue;
      }

      // 目录或隐式前缀：递归文件 + 显式空目录
      const rows = await this.repo.scanContents(sk, logical);
      for (const row of rows) {
        const childLogical = row.path;
        const rel = exportRelativePath(childLogical, logical, selectionCount);
        if (rel.length === 0) {
          continue;
        }
        if (seenFileRels.has(rel)) {
          skipped.push({
            logicalPath: childLogical,
            reason: "DUPLICATE_RELATIVE_PATH",
          });
          continue;
        }
        seenFileRels.add(rel);
        files.push({ relativePath: rel, content: row.content });
      }

      const entriesUnder = await this.repo.listEntriesUnderPrefix(sk, logical);
      for (const entry of entriesUnder) {
        if (entry.kind !== "directory") {
          continue;
        }
        const childLogical = entry.path;
        const rel = exportRelativePath(childLogical, logical, selectionCount);
        if (rel.length === 0 || seenDirRels.has(rel)) {
          continue;
        }
        seenDirRels.add(rel);
        mkdirPaths.push(rel);
      }
    }

    const filteredMkdirs = mkdirPaths
      .filter((dir) => {
        const prefix = `${dir}/`;
        return !Array.from(seenFileRels).some(
          (f) => f === dir || f.startsWith(prefix)
        );
      })
      .sort();

    return { files, mkdirPaths: filteredMkdirs, skipped };
  }
}
