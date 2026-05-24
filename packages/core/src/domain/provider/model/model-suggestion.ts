/**
 * Fetched model suggestion (not yet saved).
 *
 * @module domain/provider/model/model-suggestion
 */

export interface ModelSuggestion {
  readonly providerId: string;
  readonly vendorModelId: string;
  readonly displayName: string | null;
  readonly stale: boolean;
  readonly lastSeenAtMs: number;
}
