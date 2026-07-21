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
import {
  assertLogicalPathAllowed,
  resolveLogicalPath,
  toLogicalPath,
  toPhysicalPath,
  type VfsScope,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import type {
  BatchApplyOptions,
  BatchApplyReport,
  BatchConflict,
  BatchExportPlan,
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
  logical: string,
): Promise<void> {
  const physical = toPhysicalPath(scope, logical);
  await ensureParentDirectories(repo, `${physical}/__vfs_batch_placeholder`);
  const existing = await repo.findByPath(physical);
  if (existing == null) {
    await repo.insertDirectory(physical);
    return;
  }
  if (existing.entryKind === "file") {
    throw new Error(`path is a file, not a directory: ${logical}`);
  }
}

async function writeOrUpdateFile(
  repo: VfsEntryRepository,
  scope: VfsScope,
  logical: string,
  content: string,
): Promise<void> {
  const physical = toPhysicalPath(scope, logical);
  await ensureParentDirectories(repo, physical);
  const existing = await repo.findByPath(physical);
  if (existing == null) {
    await repo.insert(physical, content);
    return;
  }
  if (existing.entryKind === "directory") {
    throw new Error(`cannot overwrite directory with file: ${logical}`);
  }
  await repo.update(physical, content, { versionCheck: false });
}

function emptyReport(
  skipped: string[] = [],
  failed: BatchApplyReport["failed"] = [],
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
  pathKind: Map<string, "file" | "directory">,
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
 * 多选导出相对路径：单选时相对该锚点；多选时带顶层 basename，避免摊平冲突。
 */
function exportRelativePath(
  childLogical: string,
  anchorLogical: string,
  selectionCount: number,
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
    options: DefaultVfsBatchIoServiceOptions = {},
  ) {
    this.testHook = options.testHook;
  }

  async planBatchIngest(
    scope: VfsScope,
    targetDir: string,
    entries: readonly BatchIngestRawEntry[],
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

      const physical = toPhysicalPath(scope, logical);
      const existing = await this.repo.findByPath(physical);
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
    options: BatchApplyOptions,
  ): Promise<BatchApplyReport> {
    const skippedBase = [...plan.skippedBinary];

    if (plan.typeConflicts.length > 0) {
      return emptyReport(
        skippedBase,
        plan.typeConflicts.map((c) => ({ path: c.logicalPath, message: c.message })),
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

    try {
      await this.conn.transaction(async (tx) => {
        const repoTx = new SqliteVfsEntryRepository(tx);

        for (const dirLogical of plan.mkdirPaths) {
          await ensureEmptyDirectoryRow(repoTx, scope, dirLogical);
        }

        for (const write of plan.writes) {
          const logical = joinTargetLogicalPath(target, write.relativePath);
          if (this.testHook?.throwOnWriteLogical === logical) {
            throw new Error("test batch ingest failure");
          }
          await writeOrUpdateFile(repoTx, scope, logical, write.content);
          writtenLogical.push(logical);
        }
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "batch ingest transaction failed";
      const failedPath =
        this.testHook?.throwOnWriteLogical ??
        (plan.writes[0]
          ? joinTargetLogicalPath(target, plan.writes[0].relativePath)
          : target);
      // 非 session：整批回滚 → written 必须为空
      return emptyReport(skippedBase, [{ path: failedPath, message }]);
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
    writer: BatchIngestWriter,
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
        const message =
          error instanceof Error ? error.message : "mkdir failed";
        failed.push({ path: dirLogical, message });
      }
    }

    for (const write of plan.writes) {
      const logical = joinTargetLogicalPath(target, write.relativePath);
      try {
        await writer.writeFile(logical, write.content);
        written.push(logical);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "write failed";
        failed.push({ path: logical, message });
      }
    }

    return { written, skipped, failed };
  }

  async planBatchExport(
    scope: VfsScope,
    logicalPaths: readonly string[],
  ): Promise<BatchExportPlan> {
    const files: Array<{ relativePath: string; content: string }> = [];
    const mkdirPaths: string[] = [];
    const seenFileRels = new Set<string>();
    const seenDirRels = new Set<string>();
    const selectionCount = logicalPaths.length;

    for (const raw of logicalPaths) {
      const logical = resolveLogicalPath(raw);
      assertLogicalPathAllowed(scope, logical);
      const physical = toPhysicalPath(scope, logical);
      const existing = await this.repo.findByPath(physical);

      if (existing != null && existing.entryKind === "file") {
        if (existing.storageKind === "external") {
          continue;
        }
        const fileRel = basenameOf(logical);
        if (fileRel.length > 0 && !seenFileRels.has(fileRel)) {
          seenFileRels.add(fileRel);
          files.push({ relativePath: fileRel, content: existing.content });
        }
        continue;
      }

      // 目录或隐式前缀：递归文件 + 显式空目录
      const rows = await this.repo.scanContents(physical);
      for (const row of rows) {
        if (row.storageKind === "external") {
          continue;
        }
        const childLogical = toLogicalPath(scope, row.path);
        const rel = exportRelativePath(childLogical, logical, selectionCount);
        if (rel.length === 0 || seenFileRels.has(rel)) {
          continue;
        }
        seenFileRels.add(rel);
        files.push({ relativePath: rel, content: row.content });
      }

      const entriesUnder = await this.repo.listEntriesUnderPrefix(physical);
      for (const entry of entriesUnder) {
        if (entry.kind !== "directory") {
          continue;
        }
        const childLogical = toLogicalPath(scope, entry.path);
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
          (f) => f === dir || f.startsWith(prefix),
        );
      })
      .sort();

    return { files, mkdirPaths: filteredMkdirs };
  }
}
