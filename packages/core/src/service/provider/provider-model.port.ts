import type { ModelSuggestion } from "@/domain/provider/model/model-suggestion.js";
import type { SavedModel } from "@/domain/provider/model/saved-model.js";
import type { SavedModelSettingsPatch } from "@/domain/provider/model/saved-model-settings.js";

export interface ProviderModelService {
  suggestList(providerId: string): Promise<ModelSuggestion[]>;
  fetch(providerId: string): Promise<void>;
  save(
    providerId: string,
    vendorModelId: string,
    displayName?: string,
  ): Promise<SavedModel>;
  create(providerId: string, vendorModelId: string): Promise<SavedModel>;
  savedList(providerId: string): Promise<SavedModel[]>;
  /** When `displayName` is omitted, existing display name is kept. */
  editSaved(
    providerId: string,
    vendorModelId: string,
    displayName?: string | null,
  ): Promise<SavedModel>;
  deleteSaved(providerId: string, vendorModelId: string): Promise<void>;

  updateSettings(
    providerId: string,
    vendorModelId: string,
    patch: SavedModelSettingsPatch,
  ): Promise<SavedModel>;

  resetContextWindowToDefault(
    providerId: string,
    vendorModelId: string,
  ): Promise<SavedModel>;

  getSaved(applicationModelId: string): Promise<SavedModel | null>;
  getContextWindow(applicationModelId: string): Promise<number | null>;
}
