/**
 * Detect user-initiated abort during LLM HTTP / stream requests.
 *
 * @module infra/llm-protocol/logic/request-abort
 */

import { ProviderError } from "@/errors/provider-errors.js";

/** True when `signal` was aborted or `error` is an abort-shaped failure. */
export function isRequestAborted(
  error: unknown,
  signal?: AbortSignal,
): boolean {
  if (signal?.aborted === true) {
    return true;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  if (error instanceof Error && error.name === "AbortError") {
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
