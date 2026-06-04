/**
 * Default {@link PersistentPreferences} backed by internal KKV.
 *
 * @module service/persistent-preferences/impl/persistent-preferences.service
 */

import { isKkvError } from "@/errors/kkv-errors.js";
import { preferencesInvalidValue } from "@/errors/preferences-errors.js";
import { formatBoolean, parseBoolean } from "@/infra/kkv-value-codec.js";
import type { KkvService } from "@/service/kkv/kkv.port.js";
import type { PersistentPreferences } from "../persistent-preferences.port.js";

/** KKV module for user preferences (not `global-config`). */
const MODULE = "nm-preferences";

const KEY_SESSION_FS_VERSION_CHECK = "session-fs.versionCheck";

export class DefaultPersistentPreferences implements PersistentPreferences {
  constructor(private readonly kkv: KkvService) {}

  async getSessionFsVersionCheck(): Promise<boolean> {
    const raw = await this.getRaw(KEY_SESSION_FS_VERSION_CHECK);
    if (raw === undefined) {
      return true;
    }
    try {
      return parseBoolean(raw);
    } catch {
      throw preferencesInvalidValue(KEY_SESSION_FS_VERSION_CHECK, "boolean", raw);
    }
  }

  async setSessionFsVersionCheck(enabled: boolean): Promise<void> {
    await this.kkv.set(MODULE, KEY_SESSION_FS_VERSION_CHECK, formatBoolean(enabled));
  }

  async resetSessionFsVersionCheck(): Promise<void> {
    try {
      await this.kkv.delete(MODULE, KEY_SESSION_FS_VERSION_CHECK);
    } catch (error) {
      if (isKkvError(error, "NOT_FOUND")) {
        return;
      }
      throw error;
    }
  }

  async list(): Promise<ReadonlyArray<{ key: string; value: string }>> {
    const keys = await this.kkv.listKeys(MODULE);
    const entries: Array<{ key: string; value: string }> = [];
    for (const key of keys) {
      try {
        const value = await this.kkv.get(MODULE, key);
        entries.push({ key, value });
      } catch {
        // Skip keys removed between list and get
      }
    }
    entries.sort((a, b) => a.key.localeCompare(b.key));
    return entries;
  }

  async getPreference(key: string): Promise<string | undefined> {
    return this.getRaw(key);
  }

  async setPreference(key: string, value: string): Promise<void> {
    await this.kkv.set(MODULE, key, value);
  }

  private async getRaw(key: string): Promise<string | undefined> {
    try {
      return await this.kkv.get(MODULE, key);
    } catch (error) {
      if (isKkvError(error, "NOT_FOUND")) {
        return undefined;
      }
      throw error;
    }
  }
}
