/**
 * LLM protocol adapter registry.
 *
 * OpenAI streaming uses Core `postSse` inside the adapter (fetch on Node/CLI,
 * XMLHttpRequest on React Native). `configureLlmFetch` only wraps non-streaming fetch.
 *
 * @module infra/llm-protocol/logic/registry
 */

import { assert } from "@/common/assert.js";
import type { FetchFn, LlmProtocolAdapter, LlmProtocolKind } from "../ports/adapter.port.js";
import { AnthropicProtocolAdapter } from "../impl/anthropic.adapter.js";
import { GeminiProtocolAdapter } from "../impl/gemini.adapter.js";
import { OpenAiProtocolAdapter } from "../impl/openai.adapter.js";

const adapters = new Map<LlmProtocolKind, LlmProtocolAdapter>();

export const Registry = {
    /**
   * Replaces protocol adapters (call once at app startup before any LLM request).
   */
    configureLlmFetch(fetchFn: FetchFn = globalThis.fetch): void {
        adapters.clear();
        const fn = fetchFn;
        adapters.set("openai", new OpenAiProtocolAdapter(fn));
        adapters.set("anthropic", new AnthropicProtocolAdapter(fn));
        adapters.set("gemini", new GeminiProtocolAdapter(fn));
    },

    /** Returns the adapter for a protocol kind. */
    getProtocolAdapter(kind: LlmProtocolKind, fetchFn?: FetchFn): LlmProtocolAdapter {
        if (adapters.size === 0) {
            const fn = fetchFn ?? globalThis.fetch;
            adapters.set("openai", new OpenAiProtocolAdapter(fn));
            adapters.set("anthropic", new AnthropicProtocolAdapter(fn));
            adapters.set("gemini", new GeminiProtocolAdapter(fn));
        }
        const adapter = adapters.get(kind);
        assert(adapter != null, `No LLM protocol adapter for: ${kind}`);
        return adapter;
    },

    /** Clears registry (tests). @internal */
    clearProtocolAdapters(): void {
        adapters.clear();
    },
} as const;
