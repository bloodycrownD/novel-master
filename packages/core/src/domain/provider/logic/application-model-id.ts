/**
 * Application model id: `{providerId}/{vendorModelId}` (first `/` only).
 *
 * @module domain/provider/application-model-id
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";

type ProviderLogicError = AppError<"PROVIDER_INVALID_ARGUMENT">;

/** Splits `providerId/vendorModelId` at the first `/`. */
export function parseApplicationModelId(modelId: string): Result<{ providerId: string; vendorModelId: string }, ProviderLogicError> {
  const slash = modelId.indexOf("/");
  if (slash <= 0 || slash === modelId.length - 1) {
    return Result.err(new AppError("PROVIDER_INVALID_ARGUMENT", `Invalid application model id: ${modelId}`, { modelId }));
  }
  return Result.ok({ providerId: modelId.slice(0, slash), vendorModelId: modelId.slice(slash + 1) });
}

/** Formats provider id and vendor model id into application model id. */
export function formatApplicationModelId(providerId: string, vendorModelId: string): string {
  return `${providerId}/${normalizeVendorModelId(providerId, vendorModelId)}`;
}

/**
 * Normalizes vendor model ids from remote APIs or pasted application ids.
 * Strips `{providerId}/` prefix and OpenAI-style `models/` path segments.
 */
export function normalizeVendorModelId(providerId: string, raw: string): string {
  let value = raw.trim();
  if (!value) {
    return value;
  }

  const providerPrefix = `${providerId}/`;
  if (value.startsWith(providerPrefix)) {
    return value.slice(providerPrefix.length);
  }

  const parsed = parseApplicationModelId(value);
  if (parsed.ok && parsed.value.providerId === providerId) {
    return parsed.value.vendorModelId;
  }

  if (value.startsWith("models/")) {
    value = value.slice("models/".length);
  }

  return value;
}
