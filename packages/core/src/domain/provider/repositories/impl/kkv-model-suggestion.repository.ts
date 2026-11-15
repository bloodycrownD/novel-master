/**
 * KKV `nm-model-suggestions` repository (replaces SQLite suggestion table).
 *
 * @module domain/provider/repositories/impl/kkv-model-suggestion.repository
 */

import { decode } from "@/infra/serialization/decode.js";
import { isAppError } from "@/errors/app-error.js";
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

  async listByProvider(providerId: string): Promise<ModelSuggestion[]> {
    const cache = await this.readCache(providerId);
    return cache.models.map((entry) => ({ providerId, vendorModelId: entry.vendorModelId, displayName: entry.displayName, stale: entry.stale, lastSeenAtMs: entry.lastSeenAtMs }));
  }

  async upsert(suggestion: ModelSuggestion): Promise<void> {
    const cache = await this.readCache(suggestion.providerId);
    const models = [...cache.models];
    const index = models.findIndex((m) => m.vendorModelId === suggestion.vendorModelId);
    const entry = { vendorModelId: suggestion.vendorModelId, displayName: suggestion.displayName, stale: suggestion.stale, lastSeenAtMs: suggestion.lastSeenAtMs };
    if (index >= 0) {
      models[index] = entry;
    } else {
      models.push(entry);
    }
    await this.writeCache(suggestion.providerId, { schemaVersion: 1, models });
  }

  /** nm-style: keep-public — 实现 ModelSuggestionRepository 端口，由 service 经接口注入调用。 */
  async markStaleExcept(providerId: string, seen: ReadonlySet<string>): Promise<void> {
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
      byId.set(vendorModelId, { vendorModelId, displayName: existing?.displayName ?? null, stale: false, lastSeenAtMs: now });
    }
    await this.writeCache(providerId, { schemaVersion: 1, models: [...byId.values()] });
  }

  /**
   * 解包 throw 边界（错误通道迁移三期门⑦）：KKV `Result` → 领域异常通道
   * 转码点——`KKV_NOT_FOUND` 幂等忽略，其余失败原样上抛，由消费方
   * provider.service 的调用链端点（handler / 屏幕）catch 收口。
   */
  async deleteByProvider(providerId: string): Promise<void> {
    const deleted = await this.kkv.delete(MODULE, providerId);
    if (!deleted.ok) {
      if (isAppError(deleted.error, "KKV_NOT_FOUND")) return;
      throw deleted.error;
    }
  }

  /** 解包 throw 边界（同 {@link KkvModelSuggestionRepository.deleteByProvider}）：`KKV_NOT_FOUND` 归一为空缓存。 */
  private async readCache(providerId: string): Promise<ModelSuggestionCache> {
    const raw = await this.kkv.get(MODULE, providerId);
    if (!raw.ok) {
      if (isAppError(raw.error, "KKV_NOT_FOUND")) return { schemaVersion: 1, models: [] };
      throw raw.error;
    }
    return decode(JSON.parse(raw.value) as unknown, modelSuggestionCacheSchema);
  }

  private async writeCache(providerId: string, cache: ModelSuggestionCache): Promise<void> {
    await this.kkv.set(MODULE, providerId, JSON.stringify(cache));
  }
}
