/**
 * VFS domain errors: typed codes for path, version, and replace failures.
 *
 * @module errors/vfs-errors
 */

/** Discriminant codes for {@link VfsError}. */
export type VfsErrorCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "REPLACE_NOT_FOUND"
  | "DIRECTORY_NOT_EMPTY"
  | "INVALID_PATH"
  | "IS_DIRECTORY"
  | "ALREADY_EXISTS"
  | "NOT_A_DIRECTORY"
  | "PARENT_NOT_FOUND";

/**
 * Unified error for VFS service and repository operations.
 */
export class VfsError extends Error {
  readonly code: VfsErrorCode;
  readonly path?: string;
  readonly expectedVersion?: number;
  readonly actualVersion?: number;

  constructor(
    code: VfsErrorCode,
    message: string,
    options?: {
      path?: string;
      expectedVersion?: number;
      actualVersion?: number;
    },
  ) {
    super(message);
    this.name = "VfsError";
    this.code = code;
    this.path = options?.path;
    this.expectedVersion = options?.expectedVersion;
    this.actualVersion = options?.actualVersion;
  }
}

/** Type guard that works across duplicate module instances (e.g. src vs dist in tests). */
export function isVfsError(
  error: unknown,
  code?: VfsErrorCode,
): error is VfsError {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { name?: unknown; code?: unknown };
  if (candidate.name !== "VfsError" || typeof candidate.code !== "string") {
    return false;
  }
  return code === undefined || candidate.code === code;
}

/** Path does not exist. */
export function vfsNotFound(path: string): VfsError {
  return new VfsError("NOT_FOUND", `Path not found: ${path}`, { path });
}

/** Optimistic version mismatch on write. */
export function vfsConflict(
  path: string,
  expectedVersion: number,
  actualVersion: number,
): VfsError {
  return new VfsError(
    "CONFLICT",
    `Version conflict for ${path}: expected ${expectedVersion}, actual ${actualVersion}`,
    { path, expectedVersion, actualVersion },
  );
}

/** Replace oldString not found in content. */
export function vfsReplaceNotFound(path: string): VfsError {
  return new VfsError(
    "REPLACE_NOT_FOUND",
    `Replace string not found in ${path}`,
    { path },
  );
}

/** Non-recursive delete blocked by child paths. */
export function vfsDirectoryNotEmpty(path: string): VfsError {
  return new VfsError(
    "DIRECTORY_NOT_EMPTY",
    `Directory not empty: ${path}`,
    { path },
  );
}

/** Invalid or non-normalizable path. */
export function vfsInvalidPath(path: string, reason: string): VfsError {
  return new VfsError("INVALID_PATH", `Invalid path ${path}: ${reason}`, {
    path,
  });
}

/** Path is a directory row; read/write/replace are not allowed. */
export function vfsIsDirectory(path: string): VfsError {
  return new VfsError("IS_DIRECTORY", `Path is a directory: ${path}`, { path });
}

/** mkdir target already exists. */
export function vfsAlreadyExists(path: string): VfsError {
  return new VfsError("ALREADY_EXISTS", `Path already exists: ${path}`, { path });
}

/** Parent path exists as a file row. */
export function vfsNotADirectory(path: string): VfsError {
  return new VfsError("NOT_A_DIRECTORY", `Not a directory: ${path}`, { path });
}

/** mkdir parent path does not exist. */
export function vfsParentNotFound(path: string): VfsError {
  return new VfsError("PARENT_NOT_FOUND", `Parent not found: ${path}`, { path });
}
