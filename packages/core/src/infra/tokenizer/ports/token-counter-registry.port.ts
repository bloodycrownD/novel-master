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
   * Reads provider protocol from the repository on each call; openai → tiktoken; else heuristic.
   */
  forApplicationModel(applicationModelId: string): Promise<TokenCounter>;
  /** Tests: pass protocol explicitly without DB. */
  forVendorModel(vendorModelId: string, protocol: LlmProtocolKind): TokenCounter;
}
