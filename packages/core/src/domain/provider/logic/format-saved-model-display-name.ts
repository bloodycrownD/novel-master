/**
 * 派生 saved model 展示名（不落库）。
 *
 * @module domain/provider/logic/format-saved-model-display-name
 */

/** 由 providerId 与持久化 modelName 派生 UI/CLI 展示路径。 */
export function formatSavedModelDisplayName(
  providerId: string,
  modelName: string,
): string {
  return `${providerId}/${modelName}`;
}
