/**
 * 已保存的 LLM 模型。
 *
 * @module domain/provider/model/saved-model
 */

import { SavedModelDisplayName } from "../logic/format-saved-model-display-name.js";
import type { SavedModelSettings } from "./saved-model-settings.js";

export interface SavedModel {
  readonly id: string;
  readonly providerId: string;
  readonly vendorModelId: string;
  readonly modelName: string;
  readonly settings: SavedModelSettings;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export const SavedModel = {
  /**
   * 派生已保存模型主文案。
   * @param providerDisplayName 必填：调用方须先 resolve 服务商 displayName 再传入；
   *   禁止省略；禁止把 provider UUID / 旧 slug 当作第二参来源糊弄过去。
   */
  displayName(model: SavedModel, providerDisplayName: string): string {
    return SavedModelDisplayName.format(providerDisplayName, model.modelName);
  },
} as const;
