/**
 * Detect user-initiated abort during LLM HTTP / stream requests.
 *
 * @module infra/llm-protocol/logic/request-abort
 */

import { ProviderError } from "@/errors/provider-errors.js";

/** Abort-shaped failure without referencing global `DOMException` (missing on Hermes). */
export function isAbortLikeError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error != null &&
    "name" in error &&
    (error as { name: string }).name === "AbortError"
  );
}

/** Creates an abort error in Node (DOMException) or RN (Error + name). */
export function createAbortError(message = "Request aborted"): Error {
  const DOMEx = (
    globalThis as { DOMException?: new (msg: string, name: string) => Error }
  ).DOMException;
  if (typeof DOMEx === "function") {
    return new DOMEx(message, "AbortError");
  }
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

/** True when `signal` was aborted or `error` is an abort-shaped failure. */
export function isRequestAborted(
  error: unknown,
  signal?: AbortSignal,
): boolean {
  if (signal?.aborted === true) {
    return true;
  }
  if (isAbortLikeError(error)) {
    return true;
  }
  if (
    error instanceof ProviderError &&
    error.code === "HTTP_ERROR" &&
    error.message.toLowerCase().includes("abort")
  ) {
    return true;
  }
  return false;
}
