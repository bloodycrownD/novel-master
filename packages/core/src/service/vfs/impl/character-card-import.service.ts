/**
 * 默认角色卡导入：confirmed 门闸 + Phase A 路径校验 + Phase B 子树替换（对齐 ZIP）。
 *
 * @module service/vfs/impl/character-card-import.service
 */

import { insertFileSeedingRevision } from "@/domain/vfs/logic/seed-live-head-revisions.js";
import { releaseAndDeleteVfsPrefix } from "@/domain/vfs/logic/vfs-tree-copy.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import type { MdTree } from "@/domain/character-card/model/character-card.js";
import { parseCharacterCardToMdTree } from "@/domain/character-card/logic/parse-character-card-to-md-tree.js";
import { validateMdTreeForImport } from "@/domain/character-card/logic/validate-md-tree-paths.js";
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
/** @internal 导入事务回滚单测钩子 */
export type CharacterCardImportTestHook = {
  readonly throwOnInsertLogical?: string;
  /** @internal 在 Phase B deleteVfsPrefix 之前调用 */
  readonly onBeforeDeletePrefix?: () => void;
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
    const sk = scopeKey(scope);

    try {
      await this.conn.transaction(async (tx) => {
        const repoTx = new SqliteVfsEntryRepository(tx);
        const revisionTx = new SqliteVfsRevisionRepository(tx);
        this.testHook?.onBeforeDeletePrefix?.();
        await releaseAndDeleteVfsPrefix(repoTx, revisionTx, sk, directoryPath);
        await ensureEmptyDirectoryRow(repoTx, scope, directoryPath);
        for (const [logical, content] of files) {
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
        // session scope 导入完成后，给没有 checkpoint 的 message 补 baseline 快照，
        // 让回滚有正确的基线可对齐，不会因空基线误删导入的文件。
        if (this.backfillBaseline && scope.kind === "session") {
          const messageRepo = new SqliteMessageRepository(tx);
          const checkpointRepo = new SqliteMessageCheckpointRepository(tx);
          await backfillBaselineCheckpoints(
            repoTx,
            messageRepo,
            checkpointRepo,
            scope.projectId,
            scope.sessionId
          );
        }
      });
    } catch (error) {
      if (error instanceof Error && error.message === "test import failure") {
        throw error;
      }
      if (error instanceof CharacterCardError) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : "import transaction failed";
      throw characterCardError("IMPORT_FAILED", message);
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
    const tree = parseCharacterCardToMdTree(bytes);
    await this.import(scope, tree, options);
  }
}
