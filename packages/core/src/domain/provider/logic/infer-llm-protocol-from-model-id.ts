/**
 * Infers LLM protocol from saved model UUID (export path).
 *
 * @module domain/provider/logic/infer-llm-protocol-from-model-id
 */

import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";
import { BUILTIN_PROVIDER_PROTOCOLS } from "./builtin-providers.js";
import type { SavedModelRepository } from "../repositories/saved-model.port.js";

/**
 * Looks up provider by saved model id; falls back to anthropic for unknown/missing rows.
 */
export async function inferLlmProtocolFromSavedModelId(
  savedModelId: string,
  savedModels: Pick<SavedModelRepository, "findById">,
): Promise<LlmProtocolKind> {
  try {
    const saved = await savedModels.findById(savedModelId.trim());
    if (saved == null) {
      return "anthropic";
    }
    return BUILTIN_PROVIDER_PROTOCOLS[saved.providerId] ?? "anthropic";
  } catch {
    return "anthropic";
  }
}

/** @deprecated Use {@link inferLlmProtocolFromSavedModelId} with UUID saved model id. */
export async function inferLlmProtocolFromApplicationModelId(
  savedModelId: string,
  savedModels: Pick<SavedModelRepository, "findById">,
): Promise<LlmProtocolKind> {
  return inferLlmProtocolFromSavedModelId(savedModelId, savedModels);
}
