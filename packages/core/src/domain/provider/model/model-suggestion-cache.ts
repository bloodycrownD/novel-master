/**
 * KKV wire shape for fetch candidate cache (`nm-model-suggestions`).
 *
 * @module domain/provider/model/model-suggestion-cache
 */

/** One fetched model entry in the suggestion cache. */
export interface ModelSuggestionEntry {
  readonly vendorModelId: string;
  readonly displayName: string | null;
  readonly stale: boolean;
  readonly lastSeenAtMs: number;
}

/** Per-provider suggestion cache document. */
export interface ModelSuggestionCache {
  readonly schemaVersion: 1;
  readonly models: readonly ModelSuggestionEntry[];
}
