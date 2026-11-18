/**
 * Default VFS ZIP IO: export scan + import transactional subtree replace.
 *
 * @module service/vfs/impl/vfs-zip-io.service
 */

import { assert } from "@/common/assert.js";
import { yieldToEventLoop } from "@/common/concurrency.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { unwrapOrRollback } from "@/infra/tdbc/logic/transaction-helper.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { ensureParentDirectories } from "@/domain/vfs/logic/ensure-parent-dirs.js";
import { buildVfsZip } from "@/domain/vfs/logic/vfs-zip-build.js";
import { parseVfsZip } from "@/domain/vfs/logic/vfs-zip-parse.js";
import { LogicalPath, type VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { resolveZipDirectoryPath, zipDirectoryEntryNameRelativeToDirectory, zipEntryNameRelativeToDirectory } from "@/domain/vfs/logic/vfs-zip-path.js";
import { validateVfsZipEntries } from "@/domain/vfs/logic/vfs-zip-validate.js";
import { insertFileSeedingRevision } from "@/domain/vfs/logic/seed-live-head-revisions.js";
import { releaseAndDeleteVfsPrefix } from "@/domain/vfs/logic/vfs-tree-copy.js";
import { runDeferredBlobGc } from "@/domain/vfs/logic/deferred-blob-gc.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import type { VfsZipImportOptions, VfsZipIoService, ZipPathOptions } from "@/domain/vfs/ports/vfs-zip-io.port.js";
import { backfillBaselineCheckpoints } from "@/domain/message-checkpoint/logic/backfill-baseline-checkpoints.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import { clearSessionPromptCaches } from "@/service/session-kkv/logic/clear-session-prompt-caches.js";
import { ZIP_AND_CARD_IMPORT_TXN_FILE_CHUNK, chunkArray } from "@/domain/vfs/logic/vfs-import-chunk.js";
import { ensureImportDirRules } from "@/service/vfs/logic/ensure-import-dir-rules.js";
import type { WorkplaceRepository } from "@/domain/workplace/repositories/workplace.port.js";
import { SqliteWorkplaceRepository } from "@/domain/workplace/repositories/impl/sqlite-workplace.repository.js";
import { importFailure } from "./import-failure.js";
import { createLogger } from "@/infra/log/logger.js";

const log = createLogger("vfs.zip-io");
/** @internal test hook for import transaction rollback verification */
export type VfsZipImportTestHook = {
  readonly throwOnInsertLogical?: string;
  /** @internal called immediately before deleteVfsPrefix in phase B */
  readonly onBeforeDeletePrefix?: () => void;
  /**
   * @internal 替换事务内 workplace repo（故障注入：让补规则行语句真失败，
   * 验证语句级失败不毒化导入事务）。缺省时用 SqliteWorkplaceRepository(tx)。
   */
  readonly createWorkplaceRepo?: (conn: TdbcConnection) => WorkplaceRepository;
};

/**
 * 事务回调内解包走 unwrapOrRollback（总纲 §五例外 2）：本函数只在 `import` 段 B0 的
 * `conn.transaction` 回调内调用，失败靠抛错回滚。
 */
async function ensureEmptyDirectoryRow(repo: VfsEntryRepository, scope: VfsScope, logical: string): Promise<void> {
  const sk = LogicalPath.scopeKey(scope);
  if (logical === "/") {
    return;
  }
  unwrapOrRollback(await ensureParentDirectories(repo, sk, `${logical}/__vfs_zip_placeholder`));
  const existing = unwrapOrRollback(await repo.findByPath(sk, logical));
  if (existing == null) {
    unwrapOrRollback(await repo.insertDirectory(sk, logical));
    return;
  }
  if (existing.entryKind !== "directory") {
    throw new AppError("VFS_NOT_A_DIRECTORY", { path: logical, detail: `Not a directory: ${logical}` });
  }
}

async function assertDirectoryPathNotFile(repo: VfsEntryRepository, scope: VfsScope, directoryPath: string): Promise<Result<void, AppError>> {
  const existing = await repo.findByPath(LogicalPath.scopeKey(scope), directoryPath);
  if (!existing.ok) return Result.err(existing.error);
  if (existing.value != null && existing.value.entryKind === "file") {
    return Result.err(new AppError("VFS_ZIP_INVALID_PATH", { detail: `ZIP target path is a file, not a directory: ${directoryPath}` }));
  }
  return Result.ok(undefined);
}

type DefaultVfsZipIoServiceOptions = {
  /** @internal import rollback tests only */
  readonly testHook?: VfsZipImportTestHook;
  /**
   * session scope 导入完成后，给没有 checkpoint 的 message 补 baseline 快照。
   * 默认开启；仅对 session scope 生效。
   */
  readonly backfillBaseline?: boolean;
  /**
   * session scope 导入事务提交后清空提示词缓存三件套用。
   * 缺省**不清空**——由工厂负责注入；测试可直接构造 Default 验证旧行为或做故障注入。
   */
  readonly sessionKkv?: SessionKkvService;
};

export class DefaultVfsZipIoService implements VfsZipIoService {
  private readonly testHook?: VfsZipImportTestHook;
  private readonly backfillBaseline: boolean;
  private readonly sessionKkv?: SessionKkvService;

  constructor(private readonly conn: TdbcConnection, private readonly repo: VfsEntryRepository, options: DefaultVfsZipIoServiceOptions = {}) {
    this.testHook = options.testHook;
    this.backfillBaseline = options.backfillBaseline ?? true;
    this.sessionKkv = options.sessionKkv;
  }

  async export(scope: VfsScope, options?: ZipPathOptions): Promise<Result<Uint8Array, AppError>> {
    const directoryPathResult = resolveZipDirectoryPath(options?.directoryPath);
    if (!directoryPathResult.ok) return Result.err(directoryPathResult.error);
    const directoryPath = directoryPathResult.value;
    const dirCheck = await assertDirectoryPathNotFile(this.repo, scope, directoryPath);
    if (!dirCheck.ok) return Result.err(dirCheck.error);
    const sk = LogicalPath.scopeKey(scope);
    const rowsResult = await this.repo.scanContents(sk, directoryPath);
    if (!rowsResult.ok) return Result.err(rowsResult.error);
    const rows = rowsResult.value;
    const zipFiles = new Map<string, string>();

    for (const row of rows) {
      // entry_id 化后 storageKind 已下线，所有文件均为 inline blob
      const entryNameResult = zipEntryNameRelativeToDirectory(row.path, directoryPath);
      if (!entryNameResult.ok) return Result.err(entryNameResult.error);
      const entryName = entryNameResult.value;
      if (entryName.length === 0) {
        continue;
      }
      zipFiles.set(entryName, row.content);
    }

    const directoryZipNames: string[] = [];
    const entriesUnderScope = await this.repo.listEntriesUnderPrefix(sk, directoryPath);
    // 目标目录自身跳过；越出目标前缀即不变量破坏。
    const basePrefix = directoryPath === "/" ? directoryPath : directoryPath.endsWith("/") ? directoryPath.slice(0, -1) : directoryPath;
    for (const entry of entriesUnderScope) {
      if (entry.kind !== "directory" || entry.path === basePrefix) {
        continue;
      }
      assert(basePrefix === "/" || entry.path.startsWith(`${basePrefix}/`), `[invariant] Path ${entry.path} is not under prefix ${directoryPath}`);
      const directoryNameResult = zipDirectoryEntryNameRelativeToDirectory(entry.path, directoryPath);
      if (!directoryNameResult.ok) return Result.err(directoryNameResult.error);
      directoryZipNames.push(directoryNameResult.value);
    }

    return Result.ok(buildVfsZip(zipFiles, directoryZipNames));
  }

  async import(scope: VfsScope, zipBytes: Uint8Array, options: VfsZipImportOptions & ZipPathOptions): Promise<Result<void, AppError>> {
    // 五期业务抛点收编：confirmed 门闸在首个写之前、零副作用，走返回值通道
    //（本方法自四期起已是 Result 签名，段 B0 之前的路径全部 Result.err）。
    // 导入事务链（段 B0 起）仍按边界抛出，由 importFailure 收口。
    if (options.confirmed !== true) {
      return Result.err(new AppError("VFS_ZIP_NOT_CONFIRMED", { detail: "import requires explicit confirmation (CLI --yes or mobile confirm dialog)" }));
    }

    const directoryPathResult = resolveZipDirectoryPath(options.directoryPath);
    if (!directoryPathResult.ok) return Result.err(directoryPathResult.error);
    const directoryPath = directoryPathResult.value;
    const dirCheck = await assertDirectoryPathNotFile(this.repo, scope, directoryPath);
    if (!dirCheck.ok) return Result.err(dirCheck.error);

    const rawEntriesResult = parseVfsZip(zipBytes);
    if (!rawEntriesResult.ok) return Result.err(rawEntriesResult.error);
    // Phase A：路径/UTF-8/带域根前缀判定 — 任何 delete 之前
    const validated = validateVfsZipEntries(scope, rawEntriesResult.value, directoryPath);
    if (!validated.ok) return Result.err(validated.error);
    const { files, directories } = validated.value;
    const sk = LogicalPath.scopeKey(scope);
    const fileEntries = [...files];

    // 段 B0（独立短事务）：删旧子树 + 目标目录行 + 全部显式目录行。
    try {
      await this.conn.transaction(async (tx) => {
        const repoTx = new SqliteVfsEntryRepository(tx);
        const revisionTx = new SqliteVfsRevisionRepository(tx);
        this.testHook?.onBeforeDeletePrefix?.();
        await releaseAndDeleteVfsPrefix(repoTx, revisionTx, sk, directoryPath);
        // WHY: 删前缀会删掉目标目录行；即使 ZIP 为空也要保证目录仍存在
        await ensureEmptyDirectoryRow(repoTx, scope, directoryPath);
        for (const logical of directories) {
          await ensureEmptyDirectoryRow(repoTx, scope, logical);
        }
      });
    } catch (error) {
      // 测试钩子直抛原形；其余（含事务内业务 AppError 与驱动层裸 Error）一律包成
      // VFS_IMPORT_FAILED——zip 侧业务错不透传，parentCheck 失败历来也落本码。
      if (error instanceof Error && error.message === "test import failure") {
        throw error;
      }
      throw importFailure(error);
    }

    // 段 B0 提交后立刻收被替换掉的旧内容：sweep 把旧 blob 的 ref_count 递减到 0
    // 就停手（CS-06/CS-07 的守卫触发器改成「有 entry 引用就不删」），而 vfs_entry
    // 上零触发器 ⇒ 紧跟其后的 delete 不会回头收这些行。残留只能靠全库 gc 兜底，
    // 口径对齐另外 5 处删除链（project / session / message / user-vfs-turn /
    // template-pull）的既有约定：事务提交后调一次。
    await runDeferredBlobGc(this.conn);

    // 段 B1..Bk：每片 ≤200 个文件的独立短事务。补偿挂在**片失败的内层**
    // ——测试钩子直抛分支位于 IMPORT_FAILED 包装之前，只挂外层 catch 会被
    // 那条分支整个绕过，补偿永不执行。
    let committedShards = 0;
    let shardIndex = 0;
    for (const shard of chunkArray(fileEntries, ZIP_AND_CARD_IMPORT_TXN_FILE_CHUNK)) {
      try {
        await this.conn.transaction(async (tx) => {
          const repoTx = new SqliteVfsEntryRepository(tx);
          const revisionTx = new SqliteVfsRevisionRepository(tx);
          for (const [logical, content] of shard) {
            if (this.testHook?.throwOnInsertLogical === logical) {
              // 测试钩子：故意抛裸 Error 模拟事务内失败，测试按 instanceof Error 断言回滚；这是注入点而非业务错误，不纳入 AppError 口径。
              // nm-throw: keep — 测试故障注入点：调用方按 "test import failure" 原文案直供抛回（用例断言该 message），非业务错误。
              throw new Error("test import failure");
            }
            // 解包走 unwrapOrRollback（事务回调，总纲 §五例外 2）：失败靠抛错回滚。
            unwrapOrRollback(await ensureParentDirectories(repoTx, sk, logical));
            await insertFileSeedingRevision(repoTx, revisionTx, sk, logical, content);
          }
        });
        committedShards += 1;
        shardIndex += 1;
      } catch (error) {
        // 补偿：把半棵新树清掉，让域回到「目标前缀为空」的可重试态。跑在**独立事务**里，
        // 整体吞错只记 warn——补偿失败不掩盖主错误。口径写死用 `releaseAndDeleteVfsPrefix`
        // （减 live ref + 删 entry + GC 无引用 revision），**不得**用裸 `deleteVfsPrefix`
        // （不减 ref、也不 GC ⇒ 会留下一批 ref_count=1 的孤儿 revision 与永不回收的 blob）。
        try {
          await this.conn.transaction(async (tx) => {
            await releaseAndDeleteVfsPrefix(new SqliteVfsEntryRepository(tx), new SqliteVfsRevisionRepository(tx), sk, directoryPath);
          });
        } catch (compensateError) {
          log.warn("import compensation failed", { error: compensateError });
        }
        if (error instanceof Error && error.message === "test import failure") {
          throw error;
        }
        throw importFailure(error, committedShards, shardIndex + 1);
      }
      // 让步只落在片与片之间，绝不落在事务回调内部。
      await yieldToEventLoop();
    }

    // 段 R（独立短事务）：补目录规则默认行 —— 必须**晚于全部片提交**。
    // 目录全集不是 plan 阶段算出来的，而是 `ensureImportDirRules` 内部在
    // 调用时从库里现扫（`listDirectoryPathsUnderPrefix`）；独立事务看不到
    // 未提交行 ⇒ 放进某一片会漏补后续片造出的目录。
    try {
      await this.conn.transaction(async (tx) => {
        await ensureImportDirRules({
          vfsRepo: new SqliteVfsEntryRepository(tx),
          // 必须喂**段 R 这条事务**的 tx：在事务回调里用外层 this.conn 会
          // 撞驱动层 AsyncMutex 不可重入——那是死锁不是报错。
          workplaceRepo: this.testHook?.createWorkplaceRepo ? this.testHook.createWorkplaceRepo(tx) : new SqliteWorkplaceRepository(tx),
          scope,
          directoryPath,
        });
      });
    } catch (error) {
      // helper 自吞错、不阻断导入的既有语义保持不变；这里只是兜住
      // 「事务本身开不起来」这一层。
      log.warn("import dir rules failed", { error });
    }

    // 段 C（独立短事务，只装补写语句）：session scope 导入完成后，给没有
    // checkpoint 的 message 补 baseline 快照。移出导入事务是为了不把
    // 「消息数 × 文件数」的行插塞进同一条写事务。
    if (this.backfillBaseline && scope.kind === "session") {
      try {
        await this.conn.transaction(async (tx) => {
          await backfillBaselineCheckpoints({
            entryRepo: new SqliteVfsEntryRepository(tx),
            messageRepo: new SqliteMessageRepository(tx),
            checkpointRepo: new SqliteMessageCheckpointRepository(tx),
            projectId: scope.projectId,
            sessionId: scope.sessionId,
          });
        });
      } catch (error) {
        // best-effort：与紧邻的 clearSessionPromptCaches 同一口径，且不得
        // 被包进 IMPORT_FAILED。语义等价：原实现在同一事务内读到的是
        // 「自己刚插入、尚未提交的 head」，与现在的「导入已提交的 live
        // head」内容相同（insertFileSeedingRevision 已把 head 与 revision
        // 同步落库）。
        log.warn("baseline checkpoint backfill failed", { error });
      }
    }

    // 事务成功提交后再对齐提示词缓存；helper 自吞错（best-effort），不影响导入结果。
    if (this.sessionKkv && scope.kind === "session") {
      await clearSessionPromptCaches(scope.sessionId, this.sessionKkv);
    }
    return Result.ok(undefined);
  }
}
