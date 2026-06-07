/**
 * Append-only VFS revision row model (file content history).
 *
 * @module domain/vfs/model/vfs-revision
 */

import type { VfsStorageKind } from "./vfs-entry.js";

/** Persisted revision lifecycle for a file path. */
export type VfsRevisionStatus = "active" | "deleted";

/**
 * Immutable content revision for a single file path.
 */
export interface VfsRevision {
  readonly path: string;
  readonly version: number;
  readonly content: string | null;
  readonly status: VfsRevisionStatus;
  readonly mtimeMs: number;
  readonly storageKind: VfsStorageKind;
}
