/**
 * 派生 saved model 展示名（不落库）。
 *
 * @module domain/provider/logic/format-saved-model-display-name
 */

/** 主文案前缀为服务商 displayName（非技术 id）。 */
export function formatSavedModelDisplayName(
  providerDisplayName: string,
  modelName: string
): string {
  return `${providerDisplayName}/${modelName}`;
}
