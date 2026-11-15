/**
 * KKV `nm-model-suggestions` repository (replaces SQLite suggestion table).
 *
 * @module domain/provider/repositories/impl/kkv-model-suggestion.repository
 */

import { decode } from "@/infra/serialization/decode.js";
import { isAppError, type AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { KkvReaderPort } from "@/domain/kkv/ports/kkv-reader.port.js";
import type { ModelSuggestion } from "../../model/model-suggestion.js";
import type { ModelSuggestionCache } from "../../model/model-suggestion-cache.js";
import { modelSuggestionCacheSchema } from "../../model/model-suggestion-cache.schema.js";
import type { ModelSuggestionRepository } from "../model-suggestion.port.js";

/** KKV module for per-provider fetch candidate caches. */
const MODULE = "nm-model-suggestions";

/** KKV-backed model suggestion repository. */
export class KkvModelSuggestionRepository implements ModelSuggestionRepository {
  constructor(private readonly kkv: KkvReaderPort) {}

  async listByProvider(providerId: string): Promise<Result<ModelSuggestion[], AppError>> {
    const cache = await this.readCache(providerId);
    if (!cache.ok) return Result.err(cache.error);
    return Result.ok(cache.value.models.map((entry) => ({ providerId, vendorModelId: entry.vendorModelId, displayName: entry.displayName, stale: entry.stale, lastSeenAtMs: entry.lastSeenAtMs })));
  }

  async upsert(suggestion: ModelSuggestion): Promise<Result<void, AppError>> {
    const cache = await this.readCache(suggestion.providerId);
    if (!cache.ok) return Result.err(cache.error);
    const models = [...cache.value.models];
    const index = models.findIndex((m) => m.vendorModelId === suggestion.vendorModelId);
    const entry = { vendorModelId: suggestion.vendorModelId, displayName: suggestion.displayName, stale: suggestion.stale, lastSeenAtMs: suggestion.lastSeenAtMs };
    if (index >= 0) {
      models[index] = entry;
    } else {
      models.push(entry);
    }
    await this.writeCache(suggestion.providerId, { schemaVersion: 1, models });
    return Result.ok(undefined);
  }

  /** nm-style: keep-public — 实现 ModelSuggestionRepository 端口，由 service 经接口注入调用。 */
  async markStaleExcept(providerId: string, seen: ReadonlySet<string>): Promise<Result<void, AppError>> {
    const cache = await this.readCache(providerId);
    if (!cache.ok) return Result.err(cache.error);
    const now = Date.now();
    const byId = new Map(cache.value.models.map((m) => [m.vendorModelId, m]));
    for (const entry of cache.value.models) {
      if (!seen.has(entry.vendorModelId)) {
        byId.set(entry.vendorModelId, { ...entry, stale: true });
      }
    }
    for (const vendorModelId of seen) {
      const existing = byId.get(vendorModelId);
      byId.set(vendorModelId, { vendorModelId, displayName: existing?.displayName ?? null, stale: false, lastSeenAtMs: now });
    }
    await this.writeCache(providerId, { schemaVersion: 1, models: [...byId.values()] });
    return Result.ok(undefined);
  }

  /** `KKV_NOT_FOUND` 幂等归一为成功；其余 KKV 失败经 `Result.err` 原样接力。 */
  async deleteByProvider(providerId: string): Promise<Result<void, AppError>> {
    const deleted = await this.kkv.delete(MODULE, providerId);
    if (!deleted.ok && !isAppError(deleted.error, "KKV_NOT_FOUND")) return deleted;
    return Result.ok(undefined);
  }

  /** `KKV_NOT_FOUND` 归一为空缓存；其余 KKV 失败经 `Result.err` 原样接力。 */
  private async readCache(providerId: string): Promise<Result<ModelSuggestionCache, AppError>> {
    const raw = await this.kkv.get(MODULE, providerId);
    if (!raw.ok && !isAppError(raw.error, "KKV_NOT_FOUND")) return Result.err(raw.error);
    if (!raw.ok) return Result.ok({ schemaVersion: 1, models: [] });
    return Result.ok(decode(JSON.parse(raw.value) as unknown, modelSuggestionCacheSchema));
  }

  private async writeCache(providerId: string, cache: ModelSuggestionCache): Promise<void> {
    await this.kkv.set(MODULE, providerId, JSON.stringify(cache));
  }
}
