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
import {
  zipDirectoryEntryNameFromLogical,
  zipEntryNameFromLogical,
} from "@/domain/vfs/logic/vfs-zip-path.js";
import { validateVfsZipEntries } from "@/domain/vfs/logic/vfs-zip-validate.js";
import { vfsNotADirectory } from "@/errors/vfs-errors.js";
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

function relativeUnderPhysicalPrefix(fullPath: string, prefix: string): string {
  const base =
    prefix === "/" ? prefix : prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  if (fullPath === base) {
    return "";
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
  logical: string,
): Promise<void> {
  const physical = toPhysicalPath(scope, logical);
  await ensureParentDirectories(repo, `${physical}/__vfs_zip_placeholder`);
  const existing = await repo.findByPath(physical);
  if (existing == null) {
    await repo.insertDirectory(physical);
    return;
  }
  if (existing.entryKind !== "directory") {
    throw vfsNotADirectory(physical);
  }
}

export type DefaultVfsZipIoServiceOptions = {
  /** @internal import rollback tests only */
  readonly testHook?: VfsZipImportTestHook;
};

export class DefaultVfsZipIoService implements VfsZipIoService {
  private readonly testHook?: VfsZipImportTestHook;

  constructor(
    private readonly conn: TdbcConnection,
    private readonly repo: VfsEntryRepository,
    options: DefaultVfsZipIoServiceOptions = {},
  ) {
    this.testHook = options.testHook;
  }

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

    const directoryZipNames: string[] = [];
    const entriesUnderScope =
      await this.repo.listEntriesUnderPrefix(physicalPrefix);
    for (const entry of entriesUnderScope) {
      if (entry.kind !== "directory") {
        continue;
      }
      if (relativeUnderPhysicalPrefix(entry.path, physicalPrefix).length === 0) {
        continue;
      }
      const logical = toLogicalPath(scope, entry.path);
      directoryZipNames.push(zipDirectoryEntryNameFromLogical(logical));
    }

    return buildVfsZip(zipFiles, directoryZipNames);
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
    const { files, directories } = validateVfsZipEntries(scope, rawEntries);
    const physicalPrefix = scopePhysicalPrefix(scope);

    try {
      await this.conn.transaction(async (tx) => {
        const repoTx = new SqliteVfsEntryRepository(tx);
        this.testHook?.onBeforeDeletePrefix?.();
        await deleteVfsPrefix(repoTx, physicalPrefix);
        for (const logical of directories) {
          await ensureEmptyDirectoryRow(repoTx, scope, logical);
        }
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
