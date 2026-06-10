/**
 * KKV `nm-model-suggestions` repository (replaces SQLite suggestion table).
 *
 * @module domain/provider/repositories/impl/kkv-model-suggestion.repository
 */

import { decode } from "@/infra/serialization/decode.js";
import { isKkvError } from "@/errors/kkv-errors.js";
import type { KkvReaderPort } from "@/domain/kkv/ports/kkv-reader.port.js";
import type { ModelSuggestion } from "../../model/model-suggestion.js";
import type { ModelSuggestionCache } from "../../model/model-suggestion-cache.js";
import { modelSuggestionCacheSchema } from "../../model/model-suggestion-cache.schema.js";
import type { ModelSuggestionRepository } from "../model-suggestion.port.js";

/** KKV module for per-provider fetch candidate caches. */
const MODULE = "nm-model-suggestions";

function entryToSuggestion(
  providerId: string,
  entry: ModelSuggestionCache["models"][number],
): ModelSuggestion {
  return {
    providerId,
    vendorModelId: entry.vendorModelId,
    displayName: entry.displayName,
    stale: entry.stale,
    lastSeenAtMs: entry.lastSeenAtMs,
  };
}

function emptyCache(): ModelSuggestionCache {
  return { schemaVersion: 1, models: [] };
}

/** KKV-backed model suggestion repository. */
export class KkvModelSuggestionRepository implements ModelSuggestionRepository {
  constructor(private readonly kkv: KkvReaderPort) {}

  async listByProvider(providerId: string): Promise<ModelSuggestion[]> {
    const cache = await this.readCache(providerId);
    return cache.models.map((entry) => entryToSuggestion(providerId, entry));
  }

  async upsert(suggestion: ModelSuggestion): Promise<void> {
    const cache = await this.readCache(suggestion.providerId);
    const models = [...cache.models];
    const index = models.findIndex(
      (m) => m.vendorModelId === suggestion.vendorModelId,
    );
    const entry = {
      vendorModelId: suggestion.vendorModelId,
      displayName: suggestion.displayName,
      stale: suggestion.stale,
      lastSeenAtMs: suggestion.lastSeenAtMs,
    };
    if (index >= 0) {
      models[index] = entry;
    } else {
      models.push(entry);
    }
    await this.writeCache(suggestion.providerId, {
      schemaVersion: 1,
      models,
    });
  }

  async markStaleExcept(
    providerId: string,
    seen: ReadonlySet<string>,
  ): Promise<void> {
    const cache = await this.readCache(providerId);
    const now = Date.now();
    const byId = new Map(cache.models.map((m) => [m.vendorModelId, m]));
    for (const entry of cache.models) {
      if (!seen.has(entry.vendorModelId)) {
        byId.set(entry.vendorModelId, { ...entry, stale: true });
      }
    }
    for (const vendorModelId of seen) {
      const existing = byId.get(vendorModelId);
      byId.set(vendorModelId, {
        vendorModelId,
        displayName: existing?.displayName ?? null,
        stale: false,
        lastSeenAtMs: now,
      });
    }
    await this.writeCache(providerId, {
      schemaVersion: 1,
      models: [...byId.values()],
    });
  }

  async deleteByProvider(providerId: string): Promise<void> {
    try {
      await this.kkv.delete(MODULE, providerId);
    } catch (error) {
      if (isKkvError(error, "NOT_FOUND")) {
        return;
      }
      throw error;
    }
  }

  private async readCache(providerId: string): Promise<ModelSuggestionCache> {
    try {
      const raw = await this.kkv.get(MODULE, providerId);
      return decode(JSON.parse(raw) as unknown, modelSuggestionCacheSchema);
    } catch (error) {
      if (isKkvError(error, "NOT_FOUND")) {
        return emptyCache();
      }
      throw error;
    }
  }

  private async writeCache(
    providerId: string,
    cache: ModelSuggestionCache,
  ): Promise<void> {
    await this.kkv.set(MODULE, providerId, JSON.stringify(cache));
  }
}
