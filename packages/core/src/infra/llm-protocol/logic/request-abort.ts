/**
 * Detect user-initiated abort during LLM HTTP / stream requests.
 *
 * @module infra/llm-protocol/logic/request-abort
 */

import { isAppError } from "@/errors/app-error.js";

/** Abort-shaped failure without referencing global `DOMException` (missing on Hermes). */
export function isAbortLikeError(error: unknown): boolean {
  return typeof error === "object" && error != null && "name" in error && (error as { name: string }).name === "AbortError";
}

/** `createAbortError` 已上移 `domain/abort`（唯一权威定义处），这里保留 re-export 兼容既有导入点。 */
export { createAbortError } from "@/domain/abort/logic/create-abort-error.js";

/** True when `signal` was aborted or `error` is an abort-shaped failure. */
export function isRequestAborted(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted === true) {
    return true;
  }
  if (isAbortLikeError(error)) {
    return true;
  }
  if (isAppError(error, "PROVIDER_HTTP_ERROR") && error.message.toLowerCase().includes("abort")) {
    return true;
  }
  return false;
}
