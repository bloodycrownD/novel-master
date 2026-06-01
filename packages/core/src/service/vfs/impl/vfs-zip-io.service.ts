/**
 * Default VFS ZIP IO: export scan + import transactional full replace.
 *
 * @module service/vfs/impl/vfs-zip-io.service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { vfsZipError } from "@/errors/vfs-zip-errors.js";
import { ensureParentDirectories } from "@/domain/vfs/logic/ensure-parent-dirs.js";
import { buildVfsZip } from "@/domain/vfs/logic/vfs-zip-build.js";
import { parseVfsZip } from "@/domain/vfs/logic/vfs-zip-parse.js";
import {
  scopePhysicalPrefix,
  toLogicalPath,
  toPhysicalPath,
  type VfsScope,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import { zipEntryNameFromLogical } from "@/domain/vfs/logic/vfs-zip-path.js";
import { validateVfsZipEntries } from "@/domain/vfs/logic/vfs-zip-validate.js";
import { deleteVfsPrefix } from "@/domain/vfs/logic/vfs-tree-copy.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import type {
  VfsZipImportOptions,
  VfsZipIoService,
} from "@/domain/vfs/ports/vfs-zip-io.port.js";

/** @internal test hook for import transaction rollback verification */
export type VfsZipImportTestHook = {
  readonly throwOnInsertLogical?: string;
  /** @internal called immediately before deleteVfsPrefix in phase B */
  readonly onBeforeDeletePrefix?: () => void;
};

export class DefaultVfsZipIoService implements VfsZipIoService {
  constructor(
    private readonly conn: TdbcConnection,
    private readonly repo: VfsEntryRepository,
    private readonly testHook?: VfsZipImportTestHook,
  ) {}

  async export(scope: VfsScope): Promise<Uint8Array> {
    const physicalPrefix = scopePhysicalPrefix(scope);
    const rows = await this.repo.scanContents(physicalPrefix);
    const zipFiles = new Map<string, string>();

    for (const row of rows) {
      if (row.storageKind === "external") {
        throw vfsZipError(
          "EXTERNAL_NOT_SUPPORTED",
          `external storage not supported in ZIP export: ${row.path}`,
        );
      }
      const logical = toLogicalPath(scope, row.path);
      zipFiles.set(zipEntryNameFromLogical(logical), row.content);
    }

    return buildVfsZip(zipFiles);
  }

  async import(
    scope: VfsScope,
    zipBytes: Uint8Array,
    options: VfsZipImportOptions,
  ): Promise<void> {
    if (options.confirmed !== true) {
      throw vfsZipError(
        "NOT_CONFIRMED",
        "import requires explicit confirmation (CLI --yes or mobile confirm dialog)",
      );
    }

    const rawEntries = parseVfsZip(zipBytes);
    const files = validateVfsZipEntries(scope, rawEntries);
    const physicalPrefix = scopePhysicalPrefix(scope);

    try {
      await this.conn.transaction(async (tx) => {
        const repoTx = new SqliteVfsEntryRepository(tx);
        this.testHook?.onBeforeDeletePrefix?.();
        await deleteVfsPrefix(repoTx, physicalPrefix);
        for (const [logical, content] of files) {
          if (this.testHook?.throwOnInsertLogical === logical) {
            throw new Error("test import failure");
          }
          const physical = toPhysicalPath(scope, logical);
          await ensureParentDirectories(repoTx, physical);
          await repoTx.insert(physical, content);
        }
      });
    } catch (error) {
      if (error instanceof Error && error.message === "test import failure") {
        throw error;
      }
      if (error instanceof Error && error.name === "VfsZipError") {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : "import transaction failed";
      throw vfsZipError("IMPORT_FAILED", message);
    }
  }
}
