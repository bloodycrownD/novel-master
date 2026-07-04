/**
 * 从 legacy `display_name` 列推导 v1 `model_name`。
 *
 * @module domain/provider/logic/derive-model-name-from-legacy
 */

/** 按 saved-model-identity-v1 规则从旧 display_name 推导 model_name。 */
export function deriveModelNameFromLegacy(
  providerId: string,
  vendorModelId: string,
  displayName: string | null | undefined,
): string {
  const trimmed = displayName?.trim() ?? "";
  if (!trimmed) {
    return vendorModelId;
  }

  const legacyPath = `${providerId}/${vendorModelId}`;
  if (trimmed === legacyPath) {
    return vendorModelId;
  }

  const providerPrefix = `${providerId}/`;
  if (trimmed.startsWith(providerPrefix)) {
    return trimmed.slice(providerPrefix.length);
  }

  return trimmed;
}
