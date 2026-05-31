/**
 * LLM protocol adapter registry.
 *
 * @module infra/llm-protocol/logic/registry
 */

import type { FetchFn, LlmProtocolAdapter, LlmProtocolKind } from "../ports/adapter.port.js";
import { AnthropicProtocolAdapter } from "../impl/anthropic.adapter.js";
import { GeminiProtocolAdapter } from "../impl/gemini.adapter.js";
import { OpenAiProtocolAdapter } from "../impl/openai.adapter.js";

const adapters = new Map<LlmProtocolKind, LlmProtocolAdapter>();

function ensureDefaults(fetchFn?: FetchFn): void {
  if (adapters.size > 0) {
    return;
  }
  adapters.set("openai", new OpenAiProtocolAdapter(fetchFn));
  adapters.set("anthropic", new AnthropicProtocolAdapter(fetchFn));
  adapters.set("gemini", new GeminiProtocolAdapter(fetchFn));
}

/** Returns the adapter for a protocol kind. */
export function getProtocolAdapter(
  kind: LlmProtocolKind,
  fetchFn?: FetchFn,
): LlmProtocolAdapter {
  ensureDefaults(fetchFn);
  const adapter = adapters.get(kind);
  if (!adapter) {
    throw new Error(`No LLM protocol adapter for: ${kind}`);
  }
  return adapter;
}

/** Clears registry (tests). @internal */
export function clearProtocolAdapters(): void {
  adapters.clear();
}
