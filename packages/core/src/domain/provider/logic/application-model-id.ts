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
  return `${providerId}/${normalizeVendorModelId(providerId, vendorModelId)}`;
}

/**
 * Normalizes vendor model ids from remote APIs or pasted application ids.
 * Strips `{providerId}/` prefix and OpenAI-style `models/` path segments.
 */
export function normalizeVendorModelId(
  providerId: string,
  raw: string,
): string {
  let value = raw.trim();
  if (!value) {
    return value;
  }

  const providerPrefix = `${providerId}/`;
  if (value.startsWith(providerPrefix)) {
    return value.slice(providerPrefix.length);
  }

  try {
    const parsed = parseApplicationModelId(value);
    if (parsed.providerId === providerId) {
      return parsed.vendorModelId;
    }
  } catch {
    /* not a full application model id */
  }

  if (value.startsWith("models/")) {
    value = value.slice("models/".length);
  }

  return value;
}
