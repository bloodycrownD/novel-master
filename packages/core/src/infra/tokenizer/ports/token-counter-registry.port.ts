/**
 * Token counter registry port — model-aware counter resolution.
 *
 * @module infra/tokenizer/ports/token-counter-registry.port
 */

import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";
import type { TokenCounter } from "./token-counter.port.js";

/** Resolves {@link TokenCounter} by application model id or vendor model + protocol. */
export interface TokenCounterRegistry {
  /** Default heuristic counter (always available). */
  readonly heuristic: TokenCounter;
  /**
   * Resolve counter for `applicationModelId` (`providerId/vendorModelId`).
   * Loads provider protocol from injected lookup; openai → tiktoken; else heuristic.
   * Unknown provider or unsaved model (when validated) → heuristic.
   */
  forApplicationModel(applicationModelId: string): TokenCounter;
  /** Tests: skip DB, pass protocol explicitly. */
  forVendorModel(vendorModelId: string, protocol: LlmProtocolKind): TokenCounter;
}
