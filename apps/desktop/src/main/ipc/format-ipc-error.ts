/**
 * IPC error formatting — maps Core domain errors to serializable payloads.
 *
 * @module ipc/format-ipc-error
 */
import type { IpcErrorPayload } from "../../../shared/ipc-types.js";

const TYPED_ERROR_NAMES = new Set([
  "SessionFsError",
  "VfsError",
  "ChatError",
  "ProviderError",
]);

function typedDomainCode(err: Error): string | undefined {
  const coded = err as Error & { code?: unknown };
  if (typeof coded.code !== "string") {
    return undefined;
  }
  if (!TYPED_ERROR_NAMES.has(err.name)) {
    return undefined;
  }
  return coded.code;
}

/**
 * Maps a thrown value to an {@link IpcErrorPayload} for IPC responses.
 * Typed Core errors use their domain `code`; generic errors fall back to `name`.
 */
export function formatIpcError(err: unknown): IpcErrorPayload {
  if (err instanceof Error) {
    const code = typedDomainCode(err);
    if (code != null) {
      return { code, message: err.message };
    }
    return { code: err.name || "ERROR", message: err.message };
  }
  return { code: "ERROR", message: String(err) };
}
