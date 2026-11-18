/**
 * VFS 批量 ingest/export：plan + 非 session 事务 apply + session writer apply。
 *
 * @module service/vfs/impl/vfs-batch-io.service
 */

import { yieldToEventLoop } from "@/common/concurrency.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { unwrapOrRollback } from "@/infra/tdbc/logic/transaction-helper.js";
import { ParentDirs } from "@/domain/vfs/logic/ensure-parent-dirs.js";
import { VfsBatchPath } from "@/domain/vfs/logic/vfs-batch-path.js";
import { WriteWithRevision } from "@/domain/vfs/logic/write-with-revision.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import { clearSessionPromptCaches } from "@/service/session-kkv/logic/clear-session-prompt-caches.js";
import { LogicalPath, type VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { VfsImportChunk, ZIP_AND_CARD_IMPORT_TXN_FILE_CHUNK } from "@/domain/vfs/logic/vfs-import-chunk.js";
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

function emptyReport(skipped: string[] = [], failed: BatchApplyReport["failed"] = []): BatchApplyReport {
  return { written: [], skipped, failed: [...failed] };
}

/**
 * 多选导出相对路径：单选时相对该锚点；多选时带顶层 basename，避免摊平冲突。
 */
function exportRelativePath(childLogical: string, anchorLogical: string, selectionCount: number): Result<string, AppError> {
  const underResult = VfsBatchPath.relativePathUnderAnchor(childLogical, anchorLogical);
  if (!underResult.ok) return Result.err(underResult.error);
  const under = underResult.value;
  if (selectionCount <= 1) {
    return Result.ok(under);
  }
  const anchorResult = LogicalPath.resolve(anchorLogical);
  if (!anchorResult.ok) return anchorResult;
  const anchorPath = anchorResult.value;
  const rootName = anchorPath === "/" ? "" : anchorPath.slice(anchorPath.lastIndexOf("/") + 1);
  if (rootName.length === 0) {
    return Result.ok(under);
  }
  return Result.ok(under.length === 0 ? rootName : `${rootName}/${under}`);
}

type DefaultVfsBatchIoServiceOptions = {
  /** @internal 回滚单测专用 */
  readonly testHook?: VfsBatchImportTestHook;
  /**
   * session scope 导入事务提交后清空提示词缓存用。
   * 缺省**不清空**——由工厂负责注入；测试可直接构造 Default 验证旧行为或做故障注入。
   */
  readonly sessionKkv?: SessionKkvService;
};

export class DefaultVfsBatchIoService implements VfsBatchIoService {
  private readonly testHook?: VfsBatchImportTestHook;
  private readonly sessionKkv?: SessionKkvService;

  constructor(private readonly conn: TdbcConnection, private readonly repo: VfsEntryRepository, options: DefaultVfsBatchIoServiceOptions = {}) {
    this.testHook = options.testHook;
    this.sessionKkv = options.sessionKkv;
  }

  async planBatchIngest(scope: VfsScope, targetDir: string, entries: readonly BatchIngestRawEntry[]): Promise<Result<BatchIngestPlan, AppError>> {
    const resolvedTarget = LogicalPath.resolve(targetDir);
    if (!resolvedTarget.ok) return Result.err(resolvedTarget.error);
    const target = resolvedTarget.value;
    const allowedTarget = LogicalPath.validate(scope, target);
    if (!allowedTarget.ok) return Result.err(allowedTarget.error);

    const writes: BatchIngestPlanEntry[] = [];
    const mkdirPaths: string[] = [];
    const conflicts: BatchConflict[] = [];
    const skippedBinary: string[] = [];
    const typeConflicts: Array<{ logicalPath: string; message: string }> = [];
    const seenLogical = new Set<string>();
    const pathKind = new Map<string, "file" | "directory">();

    for (const entry of entries) {
      const rel = VfsBatchPath.normalizeRelativePath(entry.relativePath);
      if (rel == null) {
        skippedBinary.push(entry.relativePath);
        continue;
      }

      const kind = entry.kind === "directory" ? "directory" : "file";
      const existingKind = pathKind.get(rel);
      let typeConflict = existingKind != null && existingKind !== kind ? `path cannot be both file and directory: ${rel}` : null;
      const parts = rel.split("/").filter(Boolean);
      for (let i = 1; i < parts.length && typeConflict == null; i++) {
        const prefix = parts.slice(0, i).join("/");
        if (pathKind.get(prefix) === "file") {
          typeConflict = `cannot place ${kind} under file: ${prefix}`;
        }
      }
      if (typeConflict == null) {
        for (const [p, k] of pathKind) {
          if (k === "file" && p.startsWith(`${rel}/`)) {
            typeConflict = kind === "file" ? `cannot place file under file: ${rel}` : `cannot create directory over nested file: ${p}`;
            break;
          }
        }
      }
      if (typeConflict != null) {
        const logicalResult = VfsBatchPath.joinTargetLogicalPath(target, rel);
        if (!logicalResult.ok) return Result.err(logicalResult.error);
        typeConflicts.push({ logicalPath: logicalResult.value, message: typeConflict });
        continue;
      }
      pathKind.set(rel, kind);

      if (entry.kind === "directory") {
        const logicalResult = VfsBatchPath.joinTargetLogicalPath(target, rel);
        if (!logicalResult.ok) return Result.err(logicalResult.error);
        const logical = logicalResult.value;
        const allowedDir = LogicalPath.validate(scope, logical);
        if (!allowedDir.ok) return Result.err(allowedDir.error);
        if (!seenLogical.has(logical)) {
          seenLogical.add(logical);
          mkdirPaths.push(logical);
        }
        continue;
      }

      // 与 ZIP 校验一致：round-trip，Hermes 与 Node 行为对齐；BOM 先剥再比对。
      const payload = entry.bytes.length >= 3 && entry.bytes[0] === 0xef && entry.bytes[1] === 0xbb && entry.bytes[2] === 0xbf ? entry.bytes.subarray(3) : entry.bytes;
      const decoded = new TextDecoder("utf-8").decode(payload);
      const roundTrip = new TextEncoder().encode(decoded);
      if (payload.length !== roundTrip.length || payload.some((byte, i) => byte !== roundTrip[i])) {
        skippedBinary.push(rel);
        continue;
      }

      const logicalResult = VfsBatchPath.joinTargetLogicalPath(target, rel);
      if (!logicalResult.ok) return Result.err(logicalResult.error);
      const logical = logicalResult.value;
      const allowedLogical = LogicalPath.validate(scope, logical);
      if (!allowedLogical.ok) return Result.err(allowedLogical.error);
      if (seenLogical.has(logical)) {
        continue;
      }
      seenLogical.add(logical);

      const existing = await this.repo.findByPath(LogicalPath.scopeKey(scope), logical);
      if (!existing.ok) return Result.err(existing.error);
      if (existing.value != null && existing.value.entryKind === "file") {
        conflicts.push({ logicalPath: logical, reason: "exists" });
      }

      writes.push({ relativePath: rel, content: decoded });
    }

    return Result.ok({ writes, mkdirPaths, conflicts, skippedBinary, typeConflicts });
  }

  async applyBatchIngest(scope: VfsScope, _targetDir: string, plan: BatchIngestPlan, options: BatchApplyOptions): Promise<Result<BatchApplyReport, AppError>> {
    const skippedBase = [...plan.skippedBinary];

    if (plan.typeConflicts.length > 0) {
      const typeFailures = plan.typeConflicts.map((c) => ({ path: c.logicalPath, message: c.message }));
      return Result.ok(emptyReport(skippedBase, typeFailures));
    }

    if (plan.conflicts.length > 0 && !options.overwriteConfirmed) {
      return Result.ok(emptyReport([...skippedBase, ...plan.conflicts.map((c) => c.logicalPath)]));
    }

    const resolvedTarget = LogicalPath.resolve(_targetDir);
    if (!resolvedTarget.ok) return Result.err(resolvedTarget.error);
    const target = resolvedTarget.value;
    const sk = LogicalPath.scopeKey(scope);
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
            // 事务回调内解包走 unwrapOrRollback（总纲 §五例外 2）：失败靠抛错回滚。
            unwrapOrRollback(await ParentDirs.ensure(repoTx, sk, `${dirLogical}/__vfs_batch_placeholder`));
            const existing = unwrapOrRollback(await repoTx.findByPath(sk, dirLogical));
            if (existing == null) {
              unwrapOrRollback(await repoTx.insertDirectory(sk, dirLogical));
            } else if (existing.entryKind === "file") {
              throw new AppError("VFS_NOT_A_DIRECTORY", { detail: `path is a file, not a directory: ${dirLogical}`, path: dirLogical });
            }
          }
        });
        committedShards += 1;
      } catch (error) {
        failedPath = plan.mkdirPaths[0]!;
        failureMessage = error instanceof Error ? error.message : "batch ingest transaction failed";
      }
    }

    // 段 B1..Bk：逐片提交。`written` 只在片**提交后**并入——回调内 push 会把
    // 回滚片的内容也算进报告。
    let shardIndex = 0;
    if (failedPath == null) {
      for (const shard of VfsImportChunk.chunkArray(plan.writes, ZIP_AND_CARD_IMPORT_TXN_FILE_CHUNK)) {
        const shardWritten: string[] = [];
        try {
          await this.conn.transaction(async (tx) => {
            const repoTx = new SqliteVfsEntryRepository(tx);
            const revisionTx = new SqliteVfsRevisionRepository(tx);
            for (const write of shard) {
              // 解包走 unwrapOrRollback（事务回调，总纲 §五例外 2）：失败靠抛错回滚。
              const logical = unwrapOrRollback(VfsBatchPath.joinTargetLogicalPath(target, write.relativePath));
              if (this.testHook?.throwOnWriteLogical === logical) {
                // 测试钩子：故意抛裸 Error 模拟事务内失败，测试按 instanceof Error 断言回滚；这是注入点而非业务错误，不纳入 AppError 口径。
                // nm-throw: keep — 测试故障注入点：故意裸抛模拟事务内未知失败（失败 message 进批次报告），非业务错误。
                throw new Error("test batch ingest failure");
              }
              // WHY 外面保底父链：WriteWithRevision.write 只在**新建**分支调 ParentDirs.ensure，
              // 而批量 ingest 允许覆盖已有路径 ⇒ 已有路径的父链不由它兜。
              unwrapOrRollback(await ParentDirs.ensure(repoTx, sk, logical));
              // skipNameValidation=true：批量 ingest 是 zip 导入的创建通道，输入是**外部
              // 文件名**；`validate-entry-name.ts` 的 JSDoc 明确导入链路不走名校验
              // （外部文件名可先导入再用改名纠正）。传 false 会把「以前能导入的外部文件名」
              // 变成「导入失败」，改变一条已拍板的导入语义。
              unwrapOrRollback(await WriteWithRevision.write(repoTx, revisionTx, sk, logical, write.content, { skipNameValidation: true }));
              shardWritten.push(logical);
            }
          });
          writtenLogical.push(...shardWritten);
          committedShards += 1;
          shardIndex += 1;
        } catch (error) {
          const failedPathResult = VfsBatchPath.joinTargetLogicalPath(target, shard[0]!.relativePath);
          failedPath = failedPathResult.ok ? failedPathResult.value : failedPathResult.error.message;
          failureMessage = error instanceof Error ? error.message : "batch ingest transaction failed";
          break;
        }
        // 让步只落在片与片之间，绝不落在事务回调内部。
        await yieldToEventLoop();
      }
    }

    // WHY 清理排在 failedPath 早退**之前**：跨片失败时前几片已真实落库，下一轮
    // 提示词必须按新文件重评（否则拿旧文件重评 = 用户看到过期内容）。
    // 门闸按 `writtenLogical.length > 0` 判定 ⇒ 分片失败只要有已提交分片就清，
    // 同片失败（零写入）与下面两条早退（typeConflicts / 冲突未确认，走在分片之前
    // 直接 return，压根到不了这里）保持不清。
    await this.alignPromptCachesAfterWrite(scope, writtenLogical.length);

    if (failedPath != null) {
      return Result.ok({
        written: [...writtenLogical],
        skipped: skippedBase,
        failed: [
          {
            path: failedPath,
            // 组合站点（spec G2）：失败原因与分片进度拆 batch_ingest_partial 单 key
            message: { key: "error.vfs.batch_ingest_partial", params: { reason: failureMessage ?? "batch ingest failed", committed: committedShards, failed_shard: shardIndex + 1 } },
          },
        ],
      });
    }

    return Result.ok({
      written: writtenLogical,
      skipped: skippedBase,
      failed: [],
    });
  }

  /** nm-style: keep-public — VfsBatchIoService 端口方法；desktop session 通道经 IPC 单点消费，内联会拆散跨层契约。 */
  async applyBatchIngestWithWriter(scope: VfsScope, targetDir: string, plan: BatchIngestPlan, options: BatchApplyOptions, writer: BatchIngestWriter): Promise<Result<BatchApplyReport, AppError>> {
    const skipped: string[] = [...plan.skippedBinary];

    if (plan.typeConflicts.length > 0) {
      return Result.ok({
        written: [],
        skipped,
        failed: plan.typeConflicts.map((c) => ({
          path: c.logicalPath,
          message: c.message,
        })),
      });
    }

    if (plan.conflicts.length > 0 && !options.overwriteConfirmed) {
      for (const c of plan.conflicts) {
        if (!skipped.includes(c.logicalPath)) {
          skipped.push(c.logicalPath);
        }
      }
      return Result.ok({ written: [], skipped, failed: [] });
    }

    const resolvedTarget = LogicalPath.resolve(targetDir);
    if (!resolvedTarget.ok) return Result.err(resolvedTarget.error);
    const target = resolvedTarget.value;
    const written: string[] = [];
    const failed: Array<{ path: string; message: string }> = [];

    for (const dirLogical of plan.mkdirPaths) {
      try {
        const made = await writer.mkdir(dirLogical);
        // 已知失败沿 Result 到达（错误通道迁移七期），与未知异常同落 Report.failed。
        if (!made.ok) failed.push({ path: dirLogical, message: made.error.message });
      } catch (error) {
        const message = error instanceof Error ? error.message : "mkdir failed";
        failed.push({ path: dirLogical, message });
      }
    }

    for (const write of plan.writes) {
      const logicalResult = VfsBatchPath.joinTargetLogicalPath(target, write.relativePath);
      if (!logicalResult.ok) {
        failed.push({ path: write.relativePath, message: logicalResult.error.message });
        continue;
      }
      const logical = logicalResult.value;
      try {
        const writtenOne = await writer.writeFile(logical, write.content);
        if (writtenOne.ok) {
          written.push(logical);
        } else {
          failed.push({ path: logical, message: writtenOne.error.message });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "write failed";
        failed.push({ path: logical, message });
      }
    }

    // 与 applyBatchIngest 同一门闸（收敛到 alignPromptCachesAfterWrite，口径改一处即可）。
    // WHY 这里也必须自己清：这条链（session + user-vfs-turn 统一工具轮）自身不清缓存
    // ——vfs write 工具反而会 upsert 单条 file_cache，不清 rule_snapshot、不失效
    // token cache，所以「上层已保证一致性」不成立。
    await this.alignPromptCachesAfterWrite(scope, written.length);

    return Result.ok({ written, skipped, failed });
  }

  /**
   * 写入后对齐 session 提示词缓存（`rule_snapshot` + `file_cache` 两域 + token/用量）。
   *
   * 口径「有成功写入才清」——`writtenCount === 0` 是**零写入**早退（typeConflicts /
   * 冲突未确认 / 同片失败），没写成东西不该让会话提示词缓存失效；非空则清，
   * **包括分片失败但已有已提交分片的情形**（那部分是真落库了）。
   * best-effort：helper 自带 try/catch + warn，清理失败不影响导入结果。
   * ⚠️ **有意不补 backfillBaseline**（zip 的段 C 有、这里没有）：批量 ingest 走
   * `WriteWithRevision.write`，它自带 head 与 revision 对齐（`LiveHeadRevisionSeeder.insertFileSeeding`
   * 把 head 同步落库），与 zip「整树导入后给历史 message 补 checkpoint 快照」
   * 是两件事——这里没有需要补的 baseline 写点。
   */
  private async alignPromptCachesAfterWrite(scope: VfsScope, writtenCount: number): Promise<void> {
    if (writtenCount > 0 && this.sessionKkv && scope.kind === "session") {
      await clearSessionPromptCaches(scope.sessionId, this.sessionKkv);
    }
  }

  async planBatchExport(scope: VfsScope, logicalPaths: readonly string[]): Promise<Result<BatchExportPlan, AppError>> {
    const files: Array<{ relativePath: string; content: string }> = [];
    const mkdirPaths: string[] = [];
    const skipped: BatchExportSkip[] = [];
    const seenFileRels = new Set<string>();
    const seenDirRels = new Set<string>();
    const selectionCount = logicalPaths.length;
    const sk = LogicalPath.scopeKey(scope);

    for (const raw of logicalPaths) {
      const resolved = LogicalPath.resolve(raw);
      if (!resolved.ok) return Result.err(resolved.error);
      const logical = resolved.value;
      const allowedExport = LogicalPath.validate(scope, logical);
      if (!allowedExport.ok) return Result.err(allowedExport.error);
      const existing = await this.repo.findByPath(sk, logical);
      if (!existing.ok) return Result.err(existing.error);

      if (existing.value != null && existing.value.entryKind === "file") {
        // 锚点取**父目录**：多选时带一层父目录名，避免同名文件（中文工程常见
        // 「同名卷章」）被 `seenFileRels` 静默丢弃。单选时与旧的 basename 形态一致。
        // ⚠️ 锚点绝不能用 `logical` 自身：`VfsBatchPath.relativePathUnderAnchor(p, p)` 按定义返回空串，调用方会整个跳过。
        const anchorPathResult = LogicalPath.resolve(logical);
        if (!anchorPathResult.ok) return Result.err(anchorPathResult.error);
        const anchorPath = anchorPathResult.value;
        const anchorI = anchorPath.lastIndexOf("/");
        const fileRelResult = exportRelativePath(logical, anchorI <= 0 ? "/" : anchorPath.slice(0, anchorI), selectionCount);
        if (!fileRelResult.ok) return Result.err(fileRelResult.error);
        const fileRel = fileRelResult.value;
        if (fileRel.length > 0 && !seenFileRels.has(fileRel)) {
          seenFileRels.add(fileRel);
          files.push({ relativePath: fileRel, content: existing.value.content });
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
      const rowsResult = await this.repo.scanContents(sk, logical);
      if (!rowsResult.ok) return Result.err(rowsResult.error);
      const rows = rowsResult.value;
      for (const row of rows) {
        const childLogical = row.path;
        const relResult = exportRelativePath(childLogical, logical, selectionCount);
        if (!relResult.ok) return Result.err(relResult.error);
        const rel = relResult.value;
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
        const relResult = exportRelativePath(childLogical, logical, selectionCount);
        if (!relResult.ok) return Result.err(relResult.error);
        const rel = relResult.value;
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
        return !Array.from(seenFileRels).some((f) => f === dir || f.startsWith(prefix));
      })
      .sort();

    return Result.ok({ files, mkdirPaths: filteredMkdirs, skipped });
  }
}
