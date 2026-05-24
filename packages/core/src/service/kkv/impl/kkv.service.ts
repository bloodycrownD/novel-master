/**
 * Default KKV service implementation.
 *
 * @module service/kkv/impl/kkv.service
 */

import type { KkvRepository } from "@/domain/kkv/repositories/kkv.port.js";
import { kkvNotFound } from "@/errors/kkv-errors.js";
import type { KkvService } from "../kkv.port.js";

/**
 * KKV service delegating to {@link KkvRepository}.
 */
export class DefaultKkvService implements KkvService {
  constructor(private readonly repo: KkvRepository) {}

  listKeys(module: string): Promise<string[]> {
    return this.repo.listKeys(module);
  }

  async get(module: string, key: string): Promise<string> {
    const entry = await this.repo.get(module, key);
    if (entry == null) {
      throw kkvNotFound(module, key);
    }
    return entry.value;
  }

  set(module: string, key: string, value: string): Promise<void> {
    return this.repo.set(module, key, value);
  }

  async delete(module: string, key: string): Promise<void> {
    const deleted = await this.repo.delete(module, key);
    if (!deleted) {
      throw kkvNotFound(module, key);
    }
  }
}
