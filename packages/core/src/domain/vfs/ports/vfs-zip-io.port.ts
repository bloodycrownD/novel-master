/**
 * VFS ZIP import/export service port.
 *
 * @module domain/vfs/ports/vfs-zip-io.port
 */

import type { VfsScope } from "../logic/vfs-path-mapper.js";

/** 子树 ZIP 路径选项；缺省 `directoryPath` ≡ `/`（整域）。 */
export type ZipPathOptions = {
  readonly directoryPath?: string;
};

/** Options for domain-scoped ZIP import (full replace of target subtree). */
export interface VfsZipImportOptions {
  /** Must be true before any database writes (CLI `--yes` / mobile confirm). */
  readonly confirmed: boolean;
}

/**
 * Exports or imports a VFS scope subtree as a ZIP of inline UTF-8 text files.
 * `directoryPath` 缺省为 `/`，行为与旧整域 ZIP 一致。
 */
export interface VfsZipIoService {
  export(scope: VfsScope, options?: ZipPathOptions): Promise<Uint8Array>;
  import(
    scope: VfsScope,
    zipBytes: Uint8Array,
    options: VfsZipImportOptions & ZipPathOptions,
  ): Promise<void>;
}
