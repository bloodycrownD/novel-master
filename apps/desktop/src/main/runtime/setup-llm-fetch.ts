/**
 * Dev-only LLM fetch logging (must run before first chat request in main).
 */
import { configureLlmFetch, createLoggingFetch } from "@novel-master/core";

let configured = false;

/** Registers logging fetch for protocol adapters once per main process. */
export function ensureLlmFetchConfigured(): void {
  if (configured) {
    return;
  }
  if (process.env.NODE_ENV !== "production") {
    configureLlmFetch(createLoggingFetch(globalThis.fetch));
  }
  configured = true;
}
