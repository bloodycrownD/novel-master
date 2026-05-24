/**
 * Application model id: `{providerId}/{vendorModelId}` (first `/` only).
 *
 * @module domain/provider/application-model-id
 */

import { ProviderError } from "@/errors/provider-errors.js";

/** Splits `providerId/vendorModelId` at the first `/`. */
export function parseApplicationModelId(modelId: string): {
  providerId: string;
  vendorModelId: string;
} {
  const slash = modelId.indexOf("/");
  if (slash <= 0 || slash === modelId.length - 1) {
    throw new ProviderError(
      "INVALID_ARGUMENT",
      `Invalid application model id: ${modelId}`,
      { modelId },
    );
  }
  return {
    providerId: modelId.slice(0, slash),
    vendorModelId: modelId.slice(slash + 1),
  };
}

/** Formats provider id and vendor model id into application model id. */
export function formatApplicationModelId(
  providerId: string,
  vendorModelId: string,
): string {
  return `${providerId}/${vendorModelId}`;
}
