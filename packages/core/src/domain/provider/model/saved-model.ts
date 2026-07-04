/**
 * Saved (user-selected) LLM model.
 *
 * @module domain/provider/model/saved-model
 */

import { formatSavedModelDisplayName } from "../logic/format-saved-model-display-name.js";
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

/** 派生展示名（不落库）。 */
export function savedModelDisplayName(model: SavedModel): string {
  return formatSavedModelDisplayName(model.providerId, model.modelName);
}

/** 构造带派生 displayName 视图的 saved model（map 层使用）。 */
export type SavedModelView = SavedModel & { readonly displayName: string };

export function toSavedModelView(model: SavedModel): SavedModelView {
  return { ...model, displayName: savedModelDisplayName(model) };
}
