/**
 * Application model id helpers for config forms (no core barrel import).
 */

/** Splits `providerId/vendorModelId` at the first `/`. */
export function parseApplicationModelId(modelId: string): {
  providerId: string;
  vendorModelId: string;
} {
  const slash = modelId.indexOf("/");
  if (slash <= 0 || slash === modelId.length - 1) {
    throw new Error(`Invalid application model id: ${modelId}`);
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

function normalizeVendorModelId(providerId: string, raw: string): string {
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
