/**
 * VFS ZIP import/export service port.
 *
 * @module domain/vfs/ports/vfs-zip-io.port
 */

import type { VfsScope } from "../logic/vfs-path-mapper.js";

/** Options for domain-scoped ZIP import (full replace). */
export interface VfsZipImportOptions {
  /** Must be true before any database writes (CLI `--yes` / mobile confirm). */
  readonly confirmed: boolean;
}

/**
 * Exports or imports a single VFS scope as a ZIP of inline UTF-8 text files.
 */
export interface VfsZipIoService {
  export(scope: VfsScope): Promise<Uint8Array>;
  import(
    scope: VfsScope,
    zipBytes: Uint8Array,
    options: VfsZipImportOptions,
  ): Promise<void>;
}
