/**
 * Default VFS ZIP IO: export scan + import transactional subtree replace.
 *
 * @module service/vfs/impl/vfs-zip-io.service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { vfsZipError } from "@/errors/vfs-zip-errors.js";
import { ensureParentDirectories } from "@/domain/vfs/logic/ensure-parent-dirs.js";
import { buildVfsZip } from "@/domain/vfs/logic/vfs-zip-build.js";
import { parseVfsZip } from "@/domain/vfs/logic/vfs-zip-parse.js";
import { type VfsScope, scopeKey } from "@/domain/vfs/logic/vfs-path-mapper.js";
import {
  resolveZipDirectoryPath,
  zipDirectoryEntryNameRelativeToDirectory,
  zipEntryNameRelativeToDirectory,
} from "@/domain/vfs/logic/vfs-zip-path.js";
import { validateVfsZipEntries } from "@/domain/vfs/logic/vfs-zip-validate.js";
import { vfsNotADirectory } from "@/errors/vfs-errors.js";
import { insertFileSeedingRevision } from "@/domain/vfs/logic/seed-live-head-revisions.js";
import { releaseAndDeleteVfsPrefix } from "@/domain/vfs/logic/vfs-tree-copy.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import type {
  VfsZipImportOptions,
  VfsZipIoService,
  ZipPathOptions,
} from "@/domain/vfs/ports/vfs-zip-io.port.js";
import { backfillBaselineCheckpoints } from "@/domain/message-checkpoint/logic/backfill-baseline-checkpoints.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import { clearSessionPromptCaches } from "@/service/vfs/logic/clear-session-prompt-caches.js";
import {
  ZIP_AND_CARD_IMPORT_TXN_FILE_CHUNK,
  chunkArray,
  yieldToEventLoop,
} from "@/domain/vfs/logic/vfs-import-chunk.js";
import { ensureImportDirRules } from "@/service/vfs/logic/ensure-import-dir-rules.js";
import type { WorkplaceRepository } from "@/domain/workplace/repositories/workplace.port.js";
import { SqliteWorkplaceRepository } from "@/domain/workplace/repositories/impl/sqlite-workplace.repository.js";
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

function relativeUnderPhysicalPrefix(fullPath: string, prefix: string): string {
  const base =
    prefix === "/"
      ? prefix
      : prefix.endsWith("/")
      ? prefix.slice(0, -1)
      : prefix;
  if (fullPath === base) {
    return "";
  }
  // 根目录前缀 / 的特殊处理：fullPath 必定以 / 开头
  if (base === "/") {
    return fullPath.slice(1);
  }
  const withSlash = `${base}/`;
  if (!fullPath.startsWith(withSlash)) {
    throw new Error(`Path ${fullPath} is not under prefix ${prefix}`);
  }
  return fullPath.slice(withSlash.length);
}

async function ensureEmptyDirectoryRow(
  repo: VfsEntryRepository,
  scope: VfsScope,
  logical: string
): Promise<void> {
  const sk = scopeKey(scope);
  if (logical === "/") {
    return;
  }
  await ensureParentDirectories(repo, sk, `${logical}/__vfs_zip_placeholder`);
  const existing = await repo.findByPath(sk, logical);
  if (existing == null) {
    await repo.insertDirectory(sk, logical);
    return;
  }
  if (existing.entryKind !== "directory") {
    throw vfsNotADirectory(logical);
  }
}

/**
 * 导入失败的错误包装：保留测试钩子直抛与 VfsZipError 原形，其余包成
 * `IMPORT_FAILED`，并在消息里带上分片进度（已提交 N 片 / 失败在第 K 片）。
 *
 * 分片后**已提交片不再回滚** ⇒ 这是本条唯一的真实行为损失：旧内容在段 B0
 * 就已删除，补偿只把半棵新树清掉、不恢复旧内容。
 */
function wrapImportError(
  error: unknown,
  committedShards?: number,
  failedShard?: number
): unknown {
  if (error instanceof Error && error.message === "test import failure") {
    return error;
  }
  if (error instanceof Error && error.name === "VfsZipError") {
    return error;
  }
  const base =
    error instanceof Error ? error.message : "import transaction failed";
  const progress =
    committedShards != null && failedShard != null
      ? `（已提交 ${committedShards} 片 / 失败在第 ${failedShard} 片）`
      : "";
  const wrapped = vfsZipError("IMPORT_FAILED", `${base}${progress}`);
  return wrapped;
}

async function assertDirectoryPathNotFile(
  repo: VfsEntryRepository,
  scope: VfsScope,
  directoryPath: string
): Promise<void> {
  const existing = await repo.findByPath(scopeKey(scope), directoryPath);
  if (existing != null && existing.entryKind === "file") {
    throw vfsZipError(
      "INVALID_PATH",
      `ZIP target path is a file, not a directory: ${directoryPath}`
    );
  }
}

export type DefaultVfsZipIoServiceOptions = {
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

  constructor(
    private readonly conn: TdbcConnection,
    private readonly repo: VfsEntryRepository,
    options: DefaultVfsZipIoServiceOptions = {}
  ) {
    this.testHook = options.testHook;
    this.backfillBaseline = options.backfillBaseline ?? true;
    this.sessionKkv = options.sessionKkv;
  }

  async export(scope: VfsScope, options?: ZipPathOptions): Promise<Uint8Array> {
    const directoryPath = resolveZipDirectoryPath(options?.directoryPath);
    await assertDirectoryPathNotFile(this.repo, scope, directoryPath);
    const sk = scopeKey(scope);
    const rows = await this.repo.scanContents(sk, directoryPath);
    const zipFiles = new Map<string, string>();

    for (const row of rows) {
      // entry_id 化后 storageKind 已下线，所有文件均为 inline blob
      const entryName = zipEntryNameRelativeToDirectory(
        row.path,
        directoryPath
      );
      if (entryName.length === 0) {
        continue;
      }
      zipFiles.set(entryName, row.content);
    }

    const directoryZipNames: string[] = [];
    const entriesUnderScope = await this.repo.listEntriesUnderPrefix(
      sk,
      directoryPath
    );
    for (const entry of entriesUnderScope) {
      if (entry.kind !== "directory") {
        continue;
      }
      if (relativeUnderPhysicalPrefix(entry.path, directoryPath).length === 0) {
        continue;
      }
      directoryZipNames.push(
        zipDirectoryEntryNameRelativeToDirectory(entry.path, directoryPath)
      );
    }

    return buildVfsZip(zipFiles, directoryZipNames);
  }

  async import(
    scope: VfsScope,
    zipBytes: Uint8Array,
    options: VfsZipImportOptions & ZipPathOptions
  ): Promise<void> {
    if (options.confirmed !== true) {
      throw vfsZipError(
        "NOT_CONFIRMED",
        "import requires explicit confirmation (CLI --yes or mobile confirm dialog)"
      );
    }

    const directoryPath = resolveZipDirectoryPath(options.directoryPath);
    await assertDirectoryPathNotFile(this.repo, scope, directoryPath);

    const rawEntries = parseVfsZip(zipBytes);
    // Phase A：路径/UTF-8/带域根前缀判定 — 任何 delete 之前
    const { files, directories } = validateVfsZipEntries(
      scope,
      rawEntries,
      directoryPath
    );
    const sk = scopeKey(scope);
    const fileEntries = [...files];

    // 补偿：把半棵新树清掉，让域回到「目标前缀为空」的可重试态。
    // 跑在**独立事务**里，整体吞错只记 warn——补偿失败不掩盖主错误。
    // 口径写死用 `releaseAndDeleteVfsPrefix`（减 live ref + 删 entry + GC
    // 无引用 revision），**不得**用裸 `deleteVfsPrefix`（不减 ref、也不 GC
    // ⇒ 会留下一批 ref_count=1 的孤儿 revision 与永不回收的 blob）。
    const compensate = async (): Promise<void> => {
      try {
        await this.conn.transaction(async (tx) => {
          await releaseAndDeleteVfsPrefix(
            new SqliteVfsEntryRepository(tx),
            new SqliteVfsRevisionRepository(tx),
            sk,
            directoryPath
          );
        });
      } catch (error) {
        console.warn("[vfs-zip-io] import compensation failed", error);
      }
    };

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
      throw wrapImportError(error);
    }

    // 段 B1..Bk：每片 ≤200 个文件的独立短事务。补偿挂在**片失败的内层**
    // ——测试钩子直抛分支位于 IMPORT_FAILED 包装之前，只挂外层 catch 会被
    // 那条分支整个绕过，补偿永不执行。
    let committedShards = 0;
    let shardIndex = 0;
    for (const shard of chunkArray(
      fileEntries,
      ZIP_AND_CARD_IMPORT_TXN_FILE_CHUNK
    )) {
      try {
        await this.conn.transaction(async (tx) => {
          const repoTx = new SqliteVfsEntryRepository(tx);
          const revisionTx = new SqliteVfsRevisionRepository(tx);
          for (const [logical, content] of shard) {
            if (this.testHook?.throwOnInsertLogical === logical) {
              throw new Error("test import failure");
            }
            await ensureParentDirectories(repoTx, sk, logical);
            await insertFileSeedingRevision(
              repoTx,
              revisionTx,
              sk,
              logical,
              content
            );
          }
        });
        committedShards += 1;
        shardIndex += 1;
      } catch (error) {
        await compensate();
        throw wrapImportError(error, committedShards, shardIndex + 1);
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
          workplaceRepo: this.testHook?.createWorkplaceRepo
            ? this.testHook.createWorkplaceRepo(tx)
            : new SqliteWorkplaceRepository(tx),
          scope,
          directoryPath,
        });
      });
    } catch (error) {
      // helper 自吞错、不阻断导入的既有语义保持不变；这里只是兜住
      // 「事务本身开不起来」这一层。
      console.warn("[vfs-zip-io] import dir rules failed", error);
    }

    // 段 C（独立短事务，只装补写语句）：session scope 导入完成后，给没有
    // checkpoint 的 message 补 baseline 快照。移出导入事务是为了不把
    // 「消息数 × 文件数」的行插塞进同一条写事务。
    if (this.backfillBaseline && scope.kind === "session") {
      try {
        await this.conn.transaction(async (tx) => {
          await backfillBaselineCheckpoints(
            new SqliteVfsEntryRepository(tx),
            new SqliteMessageRepository(tx),
            new SqliteMessageCheckpointRepository(tx),
            scope.projectId,
            scope.sessionId
          );
        });
      } catch (error) {
        // best-effort：与紧邻的 clearSessionPromptCaches 同一口径，且不得
        // 被包进 IMPORT_FAILED。语义等价：原实现在同一事务内读到的是
        // 「自己刚插入、尚未提交的 head」，与现在的「导入已提交的 live
        // head」内容相同（insertFileSeedingRevision 已把 head 与 revision
        // 同步落库）。
        console.warn("[vfs-zip-io] baseline checkpoint backfill failed", error);
      }
    }

    // 事务成功提交后再对齐提示词缓存；helper 自吞错（best-effort），不影响导入结果。
    if (this.sessionKkv && scope.kind === "session") {
      await clearSessionPromptCaches(scope.sessionId, this.sessionKkv);
    }
  }
}
