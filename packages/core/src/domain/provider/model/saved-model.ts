/**
 * Saved (user-selected) LLM model.
 *
 * @module domain/provider/model/saved-model
 */

export interface SavedModel {
  readonly providerId: string;
  readonly vendorModelId: string;
  readonly displayName: string | null;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}
