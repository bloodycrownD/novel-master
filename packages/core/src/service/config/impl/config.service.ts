/**
 * Default configuration service implementation.
 *
 * @module service/config/impl/config.service
 */

import type { KkvService } from "@/service/kkv/kkv.port.js";
import { KkvError } from "@/errors/kkv-errors.js";
import { configInvalidType } from "@/errors/config-errors.js";
import type { ConfigService } from "../config.port.js";

/**
 * Configuration service backed by KKV with module "global-config".
 *
 * @remarks
 * - All values are stored as strings in KKV.
 * - Type-specific methods (`getBoolean`, `getNumber`) handle conversion.
 * - Missing keys return `undefined` from `get()`; type methods can provide defaults.
 */
export class DefaultConfigService implements ConfigService {
  private readonly MODULE = "global-config";

  constructor(private readonly kkv: KkvService) {}

  async get(key: string): Promise<string | undefined> {
    try {
      return await this.kkv.get(this.MODULE, key);
    } catch (error) {
      if (error instanceof KkvError && error.code === "NOT_FOUND") {
        return undefined;
      }
      throw error;
    }
  }

  async set(key: string, value: string): Promise<void> {
    await this.kkv.set(this.MODULE, key, value);
  }

  async getBoolean(key: string, defaultValue = false): Promise<boolean> {
    const value = await this.get(key);
    if (value === undefined) {
      return defaultValue;
    }
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
    throw configInvalidType(key, "boolean", value);
  }

  async setBoolean(key: string, value: boolean): Promise<void> {
    await this.set(key, value ? "true" : "false");
  }

  async getNumber(key: string, defaultValue = 0): Promise<number> {
    const value = await this.get(key);
    if (value === undefined) {
      return defaultValue;
    }
    const num = Number(value);
    if (Number.isNaN(num)) {
      throw configInvalidType(key, "number", value);
    }
    return num;
  }

  async setNumber(key: string, value: number): Promise<void> {
    await this.set(key, String(value));
  }

  async list(): Promise<Array<{ key: string; value: string }>> {
    const keys = await this.kkv.listKeys(this.MODULE);
    const entries: Array<{ key: string; value: string }> = [];
    for (const key of keys) {
      try {
        const value = await this.kkv.get(this.MODULE, key);
        entries.push({ key, value });
      } catch {
        // Skip keys that disappeared between list and get
      }
    }
    // Sort by key for consistent output
    entries.sort((a, b) => a.key.localeCompare(b.key));
    return entries;
  }

  async reset(key: string): Promise<void> {
    try {
      await this.kkv.delete(this.MODULE, key);
    } catch (error) {
      if (error instanceof KkvError && error.code === "NOT_FOUND") {
        // Key already doesn't exist, treat as success
        return;
      }
      throw error;
    }
  }
}
