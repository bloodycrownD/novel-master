/**
 * UUID saved model id validation (post-migration write paths).
 *
 * @module domain/provider/logic/assert-saved-model-uuid
 */

import { z } from "zod";
import { ProviderError } from "@/errors/provider-errors.js";
import type { SavedModel } from "../model/saved-model.js";
import type { SavedModelRepository } from "../repositories/saved-model.port.js";

const uuidSchema = z.string().uuid();

/** Returns true when `id` matches UUID v4/v7 format (Zod uuid). */
export function isSavedModelUuidFormat(id: string): boolean {
  return uuidSchema.safeParse(id).success;
}

/**
 * Validates UUID format, rejects legacy `provider/vendor` paths, and ensures DB row exists.
 */
export async function assertSavedModelUuid(
  savedModelId: string,
  savedModels: SavedModelRepository,
): Promise<SavedModel> {
  const trimmed = savedModelId.trim();
  if (trimmed.includes("/")) {
    throw new ProviderError(
      "INVALID_SAVED_MODEL_ID",
      `Invalid saved model id (legacy path not accepted): ${savedModelId}`,
      { modelId: savedModelId },
    );
  }
  if (!isSavedModelUuidFormat(trimmed)) {
    throw new ProviderError(
      "INVALID_SAVED_MODEL_ID",
      `Invalid saved model id (expected UUID): ${savedModelId}`,
      { modelId: savedModelId },
    );
  }
  const saved = await savedModels.findById(trimmed);
  if (saved == null) {
    throw new ProviderError(
      "INVALID_SAVED_MODEL_ID",
      `Saved model not found: ${savedModelId}`,
      { modelId: savedModelId },
    );
  }
  return saved;
}
