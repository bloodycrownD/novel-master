import type { ModelSuggestion } from "../model/model-suggestion.js";

export interface ModelSuggestionRepository {
  listByProvider(providerId: string): Promise<ModelSuggestion[]>;
  upsert(suggestion: ModelSuggestion): Promise<void>;
  markStaleExcept(providerId: string, seen: ReadonlySet<string>): Promise<void>;
  deleteByProvider(providerId: string): Promise<void>;
}
