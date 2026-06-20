/**
 * Infers LLM protocol from application model id (export path).
 *
 * @module domain/provider/logic/infer-llm-protocol-from-model-id
 */

import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";
import { BUILTIN_PROVIDER_PROTOCOLS } from "./builtin-providers.js";
import { parseApplicationModelId } from "./application-model-id.js";

/**
 * Parses providerId from `providerId/vendorModelId`; falls back to anthropic for unknown built-in gaps or parse errors.
 * Only built-in provider ids are mapped; custom providers may still mis-infer on the export path.
 */
export function inferLlmProtocolFromApplicationModelId(
  applicationModelId: string,
): LlmProtocolKind {
  try {
    const { providerId } = parseApplicationModelId(applicationModelId);
    return BUILTIN_PROVIDER_PROTOCOLS[providerId] ?? "anthropic";
  } catch {
    return "anthropic";
  }
}
