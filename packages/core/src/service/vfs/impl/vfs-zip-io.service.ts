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
import {
  toLogicalPath,
  toPhysicalPath,
  type VfsScope,
} from "@/domain/vfs/logic/vfs-path-mapper.js";
import {
  resolveZipDirectoryPath,
  zipDirectoryEntryNameRelativeToDirectory,
  zipEntryNameRelativeToDirectory,
} from "@/domain/vfs/logic/vfs-zip-path.js";
import { validateVfsZipEntries } from "@/domain/vfs/logic/vfs-zip-validate.js";
import { vfsNotADirectory } from "@/errors/vfs-errors.js";
import { deleteVfsPrefix } from "@/domain/vfs/logic/vfs-tree-copy.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import type {
  VfsZipImportOptions,
  VfsZipIoService,
  ZipPathOptions,
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

async function assertDirectoryPathNotFile(
  repo: VfsEntryRepository,
  scope: VfsScope,
  directoryPath: string,
): Promise<void> {
  const physical = toPhysicalPath(scope, directoryPath);
  const existing = await repo.findByPath(physical);
  if (existing != null && existing.entryKind === "file") {
    throw vfsZipError(
      "INVALID_PATH",
      `ZIP target path is a file, not a directory: ${directoryPath}`,
    );
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

  async export(scope: VfsScope, options?: ZipPathOptions): Promise<Uint8Array> {
    const directoryPath = resolveZipDirectoryPath(options?.directoryPath);
    await assertDirectoryPathNotFile(this.repo, scope, directoryPath);
    const physicalPrefix = toPhysicalPath(scope, directoryPath);
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
      const entryName = zipEntryNameRelativeToDirectory(logical, directoryPath);
      if (entryName.length === 0) {
        continue;
      }
      zipFiles.set(entryName, row.content);
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
      directoryZipNames.push(
        zipDirectoryEntryNameRelativeToDirectory(logical, directoryPath),
      );
    }

    return buildVfsZip(zipFiles, directoryZipNames);
  }

  async import(
    scope: VfsScope,
    zipBytes: Uint8Array,
    options: VfsZipImportOptions & ZipPathOptions,
  ): Promise<void> {
    if (options.confirmed !== true) {
      throw vfsZipError(
        "NOT_CONFIRMED",
        "import requires explicit confirmation (CLI --yes or mobile confirm dialog)",
      );
    }

    const directoryPath = resolveZipDirectoryPath(options.directoryPath);
    await assertDirectoryPathNotFile(this.repo, scope, directoryPath);

    const rawEntries = parseVfsZip(zipBytes);
    // Phase A：路径/UTF-8/带域根前缀判定 — 任何 delete 之前
    const { files, directories } = validateVfsZipEntries(
      scope,
      rawEntries,
      directoryPath,
    );
    const physicalPrefix = toPhysicalPath(scope, directoryPath);

    try {
      await this.conn.transaction(async (tx) => {
        const repoTx = new SqliteVfsEntryRepository(tx);
        this.testHook?.onBeforeDeletePrefix?.();
        await deleteVfsPrefix(repoTx, physicalPrefix);
        // WHY: deleteVfsPrefix 会删掉目标目录行；即使 ZIP 为空也要保证目录仍存在
        await ensureEmptyDirectoryRow(repoTx, scope, directoryPath);
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
