import type { ModelSuggestion } from "@/domain/provider/model/model-suggestion.js";
import type { SavedModel } from "@/domain/provider/model/saved-model.js";
import type { SavedModelSettingsPatch } from "@/domain/provider/model/saved-model-settings.js";
import type { TokenizerOverride } from "@/infra/tokenizer/logic/resolve-tokenizer-family.js";

export interface ProviderModelService {
  suggestList(providerId: string): Promise<ModelSuggestion[]>;
  fetch(providerId: string): Promise<void>;
  save(
    providerId: string,
    vendorModelId: string,
    modelName?: string,
  ): Promise<SavedModel>;
  create(providerId: string, vendorModelId: string): Promise<SavedModel>;
  savedList(providerId: string): Promise<SavedModel[]>;
  /** When `modelName` is omitted, existing model name is kept. */
  editSaved(savedModelId: string, modelName?: string): Promise<SavedModel>;
  deleteSaved(savedModelId: string): Promise<void>;

  updateSettings(
    savedModelId: string,
    patch: SavedModelSettingsPatch,
  ): Promise<SavedModel>;

  resetContextWindowToDefault(savedModelId: string): Promise<SavedModel>;

  getSavedById(savedModelId: string): Promise<SavedModel | null>;
  getContextWindow(savedModelId: string): Promise<number | null>;
  getTokenCounterMode(savedModelId: string): Promise<TokenizerOverride>;
}
