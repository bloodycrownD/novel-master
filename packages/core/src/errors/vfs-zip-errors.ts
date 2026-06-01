/**
 * VFS ZIP import/export errors.
 *
 * @module errors/vfs-zip-errors
 */

/** Discriminant codes for {@link VfsZipError}. */
export type VfsZipErrorCode =
  | "INVALID_ZIP"
  | "INVALID_PATH"
  | "INVALID_UTF8"
  | "DUPLICATE_PATH"
  | "PAYLOAD_TOO_LARGE"
  | "NOT_CONFIRMED"
  | "EXTERNAL_NOT_SUPPORTED"
  | "IMPORT_FAILED";

/**
 * Unified error for VFS ZIP parse, validate, and import/export orchestration.
 */
export class VfsZipError extends Error {
  readonly code: VfsZipErrorCode;

  constructor(code: VfsZipErrorCode, message: string) {
    super(message);
    this.name = "VfsZipError";
    this.code = code;
  }
}

export function vfsZipError(code: VfsZipErrorCode, message: string): VfsZipError {
  return new VfsZipError(code, message);
}
