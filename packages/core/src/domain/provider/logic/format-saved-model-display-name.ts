/**
 * 派生 saved model 展示名（不落库）。
 *
 * @module domain/provider/logic/format-saved-model-display-name
 */

export const SavedModelDisplayName = {
  /** 主文案前缀为服务商 displayName（非技术 id）。 */
  format(providerDisplayName: string, modelName: string): string {
    return `${providerDisplayName}/${modelName}`;
  },
} as const;
