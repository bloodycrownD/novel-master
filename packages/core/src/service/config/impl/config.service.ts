/**
 * Default ConfigService implementation backed by KKV.
 *
 * @module service/config/impl/config.service
 */

import type { KkvService } from "../../kkv/kkv.port.js";
import { KkvError } from "../../../errors/kkv-errors.js";
import { configInvalidType } from "../../../errors/config-errors.js";
import type { ConfigService } from "../config.port.js";

/**
 * KKV-backed implementation of ConfigService.
 *
 * @remarks
 * All config entries are stored in KKV module "global-config".
 * Values are always strings; type conversion is handled by getBoolean/getNumber/setBoolean/setNumber.
 */
export class DefaultConfigService implements ConfigService {
  private readonly MODULE = "global-config";

  constructor(private readonly kkv: KkvService) {}

  async get(key: string): Promise<string | undefined> {
    try {
      return await this.kkv.get(this.MODULE, key);
    } catch (error) {
      // KKV throws NOT_FOUND when key doesn't exist; we return undefined
      if (error instanceof KkvError && error.code === "NOT_FOUND") {
        return undefined;
      }
      throw error;
    }
  }

  async set(key: string, value: string): Promise<void> {
    await this.kkv.set(this.MODULE, key, value);
  }

  async getBoolean(key: string, defaultValue?: boolean): Promise<boolean> {
    const value = await this.get(key);
    if (value === undefined) {
      // Key not set: return default or false
      return defaultValue ?? false;
    }
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
    // Invalid boolean value: throw if no default, otherwise return default
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw configInvalidType(key, "boolean", value);
  }

  async setBoolean(key: string, value: boolean): Promise<void> {
    await this.set(key, value ? "true" : "false");
  }

  async getNumber(key: string, defaultValue?: number): Promise<number> {
    const value = await this.get(key);
    if (value === undefined) {
      // Key not set: return default or 0
      return defaultValue ?? 0;
    }
    const parsed = Number(value);
    // Check for valid number (not NaN, not Infinity)
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    // Invalid number value: throw if no default, otherwise return default
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw configInvalidType(key, "number", value);
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
        // Key might have been deleted between listKeys and get; skip it
      }
    }
    return entries;
  }

  async reset(key: string): Promise<void> {
    try {
      await this.kkv.delete(this.MODULE, key);
    } catch (error) {
      // Ignore NOT_FOUND errors (key already doesn't exist)
      if (error instanceof KkvError && error.code === "NOT_FOUND") {
        return;
      }
      throw error;
    }
  }
}
