/**
 * Dev-only LLM fetch logging (must run before first chat request).
 *
 * @module runtime/setup-llm-fetch
 */

import {configureLlmFetch, createLoggingFetch} from '@novel-master/core';

let configured = false;

/** Registers logging fetch for protocol adapters once per process. */
export function ensureLlmFetchConfigured(): void {
  if (configured) {
    return;
  }
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    configureLlmFetch(createLoggingFetch(globalThis.fetch));
  }
  configured = true;
}
