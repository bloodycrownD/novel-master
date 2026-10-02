/**
 * 默认角色卡导入：confirmed 门闸 + Phase A 路径校验 + Phase B 子树替换（对齐 ZIP）。
 *
 * @module service/vfs/impl/character-card-import.service
 */

import { insertFileSeedingRevision } from "@/domain/vfs/logic/seed-live-head-revisions.js";
import { releaseAndDeleteVfsPrefix } from "@/domain/vfs/logic/vfs-tree-copy.js";
import { runDeferredBlobGc } from "@/domain/vfs/logic/deferred-blob-gc.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import type { MdTree } from "@/domain/character-card/model/character-card.js";
import { parseCharacterCardToMdTree } from "@/domain/character-card/logic/parse-character-card-to-md-tree.js";
import { validateMdTreeForImport } from "@/domain/character-card/logic/validate-md-tree-paths.js";
import { validateMdTreeLimits } from "@/domain/character-card/logic/validate-md-tree-limits.js";
import { CHARACTER_CARD_MAX_INPUT_BYTES } from "@/domain/character-card/logic/character-card-limits.js";
import type {
  CharacterCardImportOptions,
  CharacterCardImportService,
} from "@/domain/vfs/ports/character-card-import.port.js";
import {
  CharacterCardError,
  characterCardError,
} from "@/errors/character-card-errors.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { ensureParentDirectories } from "@/domain/vfs/logic/ensure-parent-dirs.js";
import { scopeKey, type VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { resolveZipDirectoryPath } from "@/domain/vfs/logic/vfs-zip-path.js";
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
/** @internal 导入事务回滚单测钩子 */
export type CharacterCardImportTestHook = {
  readonly throwOnInsertLogical?: string;
  /** @internal 在 Phase B deleteVfsPrefix 之前调用 */
  readonly onBeforeDeletePrefix?: () => void;
  /**
   * @internal 替换事务内 workplace repo（T-I5 故障注入：让补规则行语句真失败，
   * 验证语句级失败不毒化导入事务）。缺省时用 SqliteWorkplaceRepository(tx)。
   */
  readonly createWorkplaceRepo?: (conn: TdbcConnection) => WorkplaceRepository;
};

async function ensureEmptyDirectoryRow(
  repo: VfsEntryRepository,
  scope: VfsScope,
  logical: string
): Promise<void> {
  const sk = scopeKey(scope);
  if (logical === "/") {
    return;
  }
  await ensureParentDirectories(repo, sk, `${logical}/__vfs_card_placeholder`);
  const existing = await repo.findByPath(sk, logical);
  if (existing == null) {
    await repo.insertDirectory(sk, logical);
    return;
  }
  if (existing.entryKind !== "directory") {
    throw characterCardError(
      "INVALID_PATH",
      `character card target path is a file, not a directory: ${logical}`
    );
  }
}

/**
 * 导入失败的错误包装：保留测试钩子直抛与 CharacterCardError 原形，其余包成
 * `IMPORT_FAILED`，并在消息里带上分片进度。
 *
 * 分片后**已提交片不再回滚** ⇒ 本条唯一的真实行为损失：旧内容在段 B0 就已
 * 删除，补偿只把半棵新树清掉、不恢复旧内容。
 */
function wrapCardImportError(
  error: unknown,
  committedShards?: number,
  failedShard?: number
): unknown {
  if (error instanceof Error && error.message === "test import failure") {
    return error;
  }
  if (error instanceof CharacterCardError) {
    return error;
  }
  const base =
    error instanceof Error ? error.message : "import transaction failed";
  const progress =
    committedShards != null && failedShard != null
      ? `（已提交 ${committedShards} 片 / 失败在第 ${failedShard} 片）`
      : "";
  return characterCardError("IMPORT_FAILED", `${base}${progress}`);
}

async function assertDirectoryPathNotFile(
  repo: VfsEntryRepository,
  scope: VfsScope,
  directoryPath: string
): Promise<void> {
  const existing = await repo.findByPath(scopeKey(scope), directoryPath);
  if (existing != null && existing.entryKind === "file") {
    throw characterCardError(
      "INVALID_PATH",
      `character card target path is a file, not a directory: ${directoryPath}`
    );
  }
}

export type DefaultCharacterCardImportServiceOptions = {
  /** @internal import rollback tests only */
  readonly testHook?: CharacterCardImportTestHook;
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

export class DefaultCharacterCardImportService
  implements CharacterCardImportService
{
  private readonly testHook?: CharacterCardImportTestHook;
  private readonly backfillBaseline: boolean;
  private readonly sessionKkv?: SessionKkvService;

  constructor(
    private readonly conn: TdbcConnection,
    private readonly repo: VfsEntryRepository,
    options: DefaultCharacterCardImportServiceOptions = {}
  ) {
    this.testHook = options.testHook;
    this.backfillBaseline = options.backfillBaseline ?? true;
    this.sessionKkv = options.sessionKkv;
  }

  async import(
    scope: VfsScope,
    tree: MdTree,
    options: CharacterCardImportOptions
  ): Promise<void> {
    if (options.confirmed !== true) {
      throw characterCardError(
        "NOT_CONFIRMED",
        "import requires explicit confirmation (CLI --yes or confirm dialog)"
      );
    }

    const directoryPath = resolveZipDirectoryPath(options.directoryPath);
    await assertDirectoryPathNotFile(this.repo, scope, directoryPath);

    // Phase A：路径校验 — 任何 delete 之前；禁止 ZIP basename / validateVfsZipEntries
    const files = validateMdTreeForImport(scope, tree, directoryPath);
    // 体积/条目闸门 — 事务之前，超限零写库（防巨型卡片落库后形成重启崩溃循环）
    validateMdTreeLimits(files);
    const sk = scopeKey(scope);
    const fileEntries = [...files];

    // 补偿：把半棵新树清掉，让域回到「目标前缀为空」的可重试态。口径与 ZIP
    // 侧统一用 `releaseAndDeleteVfsPrefix`（减 live ref + 删 entry + GC 无引用
    // revision）；裸 `deleteVfsPrefix` 会留下永不回收的孤儿 revision 与 blob。
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
        console.warn("[character-card] import compensation failed", error);
      }
    };

    // 段 B0（独立短事务）：删旧子树 + 目标目录行。
    try {
      await this.conn.transaction(async (tx) => {
        const repoTx = new SqliteVfsEntryRepository(tx);
        const revisionTx = new SqliteVfsRevisionRepository(tx);
        this.testHook?.onBeforeDeletePrefix?.();
        await releaseAndDeleteVfsPrefix(repoTx, revisionTx, sk, directoryPath);
        await ensureEmptyDirectoryRow(repoTx, scope, directoryPath);
      });
    } catch (error) {
      throw wrapCardImportError(error);
    }

    // 段 B0 提交后收被替换掉的旧内容：sweep 只把旧 blob 的 ref_count 递减到 0
    // 就停手（CS-06/CS-07 的守卫触发器要求「无 entry 引用」才删行），vfs_entry
    // 上零触发器补不了这一步 ⇒ 残留只能靠全库 gc。口径对齐 ZIP 导入链与另外
    // 5 处删除链的既有约定：事务提交后调一次。
    await runDeferredBlobGc(this.conn);

    // 段 B1..Bk：每片 ≤200 个文件的独立短事务；补偿挂在**片失败的内层**
    // （测试钩子直抛分支位于 IMPORT_FAILED 包装之前，只挂外层 catch 会被绕过）。
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
        throw wrapCardImportError(error, committedShards, shardIndex + 1);
      }
      // 让步只落在片与片之间，绝不落在事务回调内部。
      await yieldToEventLoop();
    }

    // 段 R（独立短事务）：补目录规则默认行 —— 必须**晚于全部片提交**
    // （目录全集靠 `listDirectoryPathsUnderPrefix` 在调用时现扫）。
    try {
      await this.conn.transaction(async (tx) => {
        await ensureImportDirRules({
          vfsRepo: new SqliteVfsEntryRepository(tx),
          // 必须喂**段 R 这条事务**的 tx：在事务回调里用外层 this.conn 会撞
          // 驱动层 AsyncMutex 不可重入——那是死锁不是报错。
          workplaceRepo: this.testHook?.createWorkplaceRepo
            ? this.testHook.createWorkplaceRepo(tx)
            : new SqliteWorkplaceRepository(tx),
          scope,
          directoryPath,
        });
      });
    } catch (error) {
      console.warn("[character-card] import dir rules failed", error);
    }

    // 段 C（独立短事务，只装补写语句）：session scope 导入完成后，给没有
    // checkpoint 的 message 补 baseline 快照，让回滚有正确的基线可对齐。
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
        // best-effort：与紧邻的 clearSessionPromptCaches 同一口径，不包进 IMPORT_FAILED。
        console.warn(
          "[character-card] baseline checkpoint backfill failed",
          error
        );
      }
    }

    // 事务成功提交后再对齐提示词缓存；helper 自吞错（best-effort），不影响导入结果。
    if (this.sessionKkv && scope.kind === "session") {
      await clearSessionPromptCaches(scope.sessionId, this.sessionKkv);
    }
  }

  async importFromBytes(
    scope: VfsScope,
    bytes: Uint8Array,
    options: CharacterCardImportOptions
  ): Promise<void> {
    // 解析在 confirmed 门闸之后、delete 之前；解析失败零写库
    if (options.confirmed !== true) {
      throw characterCardError(
        "NOT_CONFIRMED",
        "import requires explicit confirmation (CLI --yes or confirm dialog)"
      );
    }
    // 输入闸门 — 解析之前拦截：巨型输入在解码链上会产生多份全尺寸拷贝
    // （base64 → latin1 → JSON），这里用纯长度比对直接拒绝，不进解析。
    if (bytes.length > CHARACTER_CARD_MAX_INPUT_BYTES) {
      throw characterCardError(
        "TOO_LARGE",
        `角色卡文件过大：${bytes.length} 字节，超过输入上限 ${CHARACTER_CARD_MAX_INPUT_BYTES} 字节（约 48MB），已拒绝导入`
      );
    }
    const tree = parseCharacterCardToMdTree(bytes);
    await this.import(scope, tree, options);
  }
}
